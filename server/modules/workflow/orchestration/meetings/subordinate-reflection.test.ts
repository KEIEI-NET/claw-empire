import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubordinateReflectionRunner,
  invalidateMeetingReflectionCache,
  isMeetingDelegateReflectionEnabled,
  sanitizeReflectionText,
  selectMeetingSubordinate,
} from "./subordinate-reflection.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      department_id TEXT,
      role TEXT,
      status TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

function addAgent(db: DatabaseSync, a: { id: string; dept: string; role: string; status: string }): void {
  db.prepare("INSERT INTO agents (id, name, department_id, role, status) VALUES (?, ?, ?, ?, ?)").run(
    a.id,
    a.id,
    a.dept,
    a.role,
    a.status,
  );
}

describe("selectMeetingSubordinate", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = createDb();
    addAgent(db, { id: "lead", dept: "dev", role: "team_leader", status: "idle" });
  });
  afterEach(() => db.close());

  it("excludes the leader and other team leaders", () => {
    addAgent(db, { id: "lead2", dept: "dev", role: "team_leader", status: "idle" });
    expect(selectMeetingSubordinate(db, "dev", "lead")).toBeNull();
  });

  it("prefers idle over working, and senior over junior", () => {
    addAgent(db, { id: "junior-idle", dept: "dev", role: "junior", status: "idle" });
    addAgent(db, { id: "senior-working", dept: "dev", role: "senior", status: "working" });
    addAgent(db, { id: "senior-idle", dept: "dev", role: "senior", status: "idle" });
    expect(selectMeetingSubordinate(db, "dev", "lead")?.id).toBe("senior-idle");
  });

  it("ranks status idle > break > working", () => {
    addAgent(db, { id: "senior-working", dept: "dev", role: "senior", status: "working" });
    addAgent(db, { id: "senior-break", dept: "dev", role: "senior", status: "break" });
    expect(selectMeetingSubordinate(db, "dev", "lead")?.id).toBe("senior-break");
    addAgent(db, { id: "senior-idle", dept: "dev", role: "senior", status: "idle" });
    expect(selectMeetingSubordinate(db, "dev", "lead")?.id).toBe("senior-idle");
  });

  it("ignores offline subordinates", () => {
    addAgent(db, { id: "off", dept: "dev", role: "senior", status: "offline" });
    expect(selectMeetingSubordinate(db, "dev", "lead")).toBeNull();
  });

  it("returns null for a null department", () => {
    expect(selectMeetingSubordinate(db, null, "lead")).toBeNull();
  });

  it("does not cross department boundaries", () => {
    addAgent(db, { id: "design-jr", dept: "design", role: "junior", status: "idle" });
    expect(selectMeetingSubordinate(db, "dev", "lead")).toBeNull();
  });
});

describe("sanitizeReflectionText", () => {
  it("passes clean prose through unchanged", () => {
    const t = "WebSocket接続数の上限を先に数値で確認すべきです。";
    expect(sanitizeReflectionText(t)).toBe(t);
  });

  it("rejects a raw JSON tool payload (the live codex case)", () => {
    const blob = '{"workdir":"/private/tmp/claude-501/scratch","cmd":"ls","type":"tool_use"}';
    expect(sanitizeReflectionText(blob)).toBe("");
  });

  it("rejects a truncated/invalid JSON payload that is clearly key:value", () => {
    expect(sanitizeReflectionText('{"workdir":"/private/tmp/abc')).toBe("");
  });

  it("strips inline tool_use json and keeps the surrounding prose", () => {
    const raw = 'リスクを確認します。{"type":"tool_use","name":"bash"} 接続上限が懸念です。';
    const out = sanitizeReflectionText(raw);
    expect(out).toContain("リスクを確認します");
    expect(out).toContain("接続上限が懸念です");
    expect(out).not.toContain("tool_use");
  });

  it("strips the real codex blob shape (type not first) inline in prose", () => {
    const raw = '接続上限が懸念です。{"workdir":"/private/tmp/x","cmd":"ls","type":"tool_use"} 再接続戦略が必要です。';
    const out = sanitizeReflectionText(raw);
    expect(out).toContain("接続上限が懸念です");
    expect(out).toContain("再接続戦略が必要です");
    expect(out).not.toContain("workdir");
    expect(out).not.toContain("tool_use");
  });

  it("drops bracket-only and [stdout]/[reasoning] noise lines", () => {
    const raw = "[reasoning] thinking...\n{\n}\n実UIのE2Eを追加すべきです。\n[stdout] done";
    const out = sanitizeReflectionText(raw);
    expect(out).toBe("実UIのE2Eを追加すべきです。");
  });

  it("unwraps a fully-quoted string", () => {
    expect(sanitizeReflectionText('"端的に述べると、再接続戦略が必要です。"')).toBe("端的に述べると、再接続戦略が必要です。");
  });

  it("returns empty for empty/whitespace input", () => {
    expect(sanitizeReflectionText("")).toBe("");
    expect(sanitizeReflectionText("   \n  ")).toBe("");
    expect(sanitizeReflectionText(null)).toBe("");
  });

  it("caps length code-point-safely (emoji not split)", () => {
    const out = sanitizeReflectionText("🚀".repeat(400), 10);
    expect([...out].length).toBe(10); // 9 emoji + ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out.includes("�")).toBe(false);
  });
});

describe("isMeetingDelegateReflectionEnabled", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = createDb();
    invalidateMeetingReflectionCache();
  });
  afterEach(() => {
    db.close();
    invalidateMeetingReflectionCache();
  });

  it("defaults to ON when the setting is absent", () => {
    expect(isMeetingDelegateReflectionEnabled(db)).toBe(true);
  });

  it("is OFF when the setting is 'false'", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('meetingDelegateReflectionEnabled', 'false')").run();
    invalidateMeetingReflectionCache();
    expect(isMeetingDelegateReflectionEnabled(db)).toBe(false);
  });
});

describe("runSubordinateReflection", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = createDb();
    invalidateMeetingReflectionCache();
    addAgent(db, { id: "lead", dept: "dev", role: "team_leader", status: "idle" });
  });
  afterEach(() => {
    db.close();
    invalidateMeetingReflectionCache();
  });

  const baseReq = {
    leader: { id: "lead", department_id: "dev", role: "team_leader" },
    leaderStatement: "We will ship the cache layer this sprint.",
    taskTitle: "Perf work",
    taskDescription: "kickoff",
    workflowPackKey: null,
    round: 1,
    lang: "en",
  };

  function makeRunner(runText: string | null) {
    return createSubordinateReflectionRunner({
      db,
      buildMeetingPrompt: () => "PROMPT",
      runAgentOneShot: vi.fn(async () => (runText === null ? { error: "boom" } : { text: runText })),
      getAgentDisplayName: (a) => a.id,
    });
  }

  it("returns null when the master switch is OFF", async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('meetingDelegateReflectionEnabled', 'off')").run();
    invalidateMeetingReflectionCache();
    addAgent(db, { id: "dev-jr", dept: "dev", role: "junior", status: "idle" });
    const { runSubordinateReflection } = makeRunner("some take");
    expect(await runSubordinateReflection(baseReq)).toBeNull();
  });

  it("returns null when the department has no subordinate", async () => {
    const { runSubordinateReflection } = makeRunner("some take");
    expect(await runSubordinateReflection(baseReq)).toBeNull();
  });

  it("returns the subordinate take on the happy path", async () => {
    addAgent(db, { id: "dev-jr", dept: "dev", role: "senior", status: "idle" });
    const { runSubordinateReflection } = makeRunner("Watch the cache invalidation edge case.");
    const result = await runSubordinateReflection(baseReq);
    expect(result?.subordinate.id).toBe("dev-jr");
    expect(result?.text).toBe("Watch the cache invalidation edge case.");
  });

  it("returns null when the subordinate run yields no text", async () => {
    addAgent(db, { id: "dev-jr", dept: "dev", role: "senior", status: "idle" });
    const { runSubordinateReflection } = makeRunner(null);
    expect(await runSubordinateReflection(baseReq)).toBeNull();
  });

  it("returns null when the run is raw tool/JSON output (no fake line injected)", async () => {
    addAgent(db, { id: "dev-jr", dept: "dev", role: "senior", status: "idle" });
    const { runSubordinateReflection } = makeRunner('{"workdir":"/tmp/x","type":"tool_use"}');
    expect(await runSubordinateReflection(baseReq)).toBeNull();
  });

  it("sanitizes surrounding noise but keeps the real take", async () => {
    addAgent(db, { id: "dev-jr", dept: "dev", role: "senior", status: "idle" });
    const { runSubordinateReflection } = makeRunner('[reasoning] hmm\n再接続戦略の検証が必要です。');
    const result = await runSubordinateReflection(baseReq);
    expect(result?.text).toBe("再接続戦略の検証が必要です。");
  });
});
