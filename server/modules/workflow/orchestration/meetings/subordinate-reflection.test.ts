import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubordinateReflectionRunner,
  invalidateMeetingReflectionCache,
  isMeetingDelegateReflectionEnabled,
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
});
