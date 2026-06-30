import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeetingMinutesTools } from "./minutes.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE meeting_minutes (
      id TEXT PRIMARY KEY, task_id TEXT, meeting_type TEXT, round INTEGER,
      title TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, created_at INTEGER
    );
    CREATE TABLE meeting_minute_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT, seq INTEGER,
      speaker_agent_id TEXT, speaker_name TEXT, department_name TEXT, role_label TEXT,
      message_type TEXT, content TEXT, created_at INTEGER
    );
  `);
  return db;
}

const agent = {
  id: "a-1",
  name: "Lead",
  name_ko: "리더",
  role: "team_leader",
  personality: null,
  status: "idle",
  department_id: "dev",
  current_task_id: null,
  avatar_emoji: "🧑‍💼",
  cli_provider: null,
  oauth_account_id: null,
  api_provider_id: null,
  api_model: null,
  cli_model: null,
  cli_reasoning_level: null,
};

function makeTools(db: DatabaseSync, broadcast: ReturnType<typeof vi.fn>) {
  let clock = 1000;
  return createMeetingMinutesTools({
    db: db as never,
    nowMs: () => clock++,
    getDeptName: () => "Dev",
    getRoleLabel: () => "Team Leader",
    getAgentDisplayName: (a: { name: string }) => a.name,
    pickL: (c: unknown) => String(c),
    l: () => "",
    summarizeForMeetingBubble: (t: string) => t,
    appendTaskLog: () => undefined,
    broadcast,
    REVIEW_MAX_MEMO_ITEMS_PER_ROUND: 5,
    REVIEW_MAX_MEMO_ITEMS_PER_DEPT: 5,
  });
}

describe("meeting minutes live broadcasts (Phase 10)", () => {
  let db: DatabaseSync;
  let broadcast: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    db = createDb();
    broadcast = vi.fn();
  });
  afterEach(() => db.close());

  it("broadcasts meeting_started on begin", () => {
    const tools = makeTools(db, broadcast);
    const meetingId = tools.beginMeetingMinutes("task-1", "planned", 2, "Kickoff");
    const call = broadcast.mock.calls.find((c) => c[0] === "meeting_started");
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({ task_id: "task-1", meeting_id: meetingId, meeting_type: "planned", round: 2 });
  });

  it("broadcasts the full entry (with task_id) on append", () => {
    const tools = makeTools(db, broadcast);
    const meetingId = tools.beginMeetingMinutes("task-1", "planned", 1, "Kickoff");
    broadcast.mockClear();
    tools.appendMeetingMinuteEntry(meetingId, 3, agent, "en", "chat", "Ship the cache 🚀", null);
    const call = broadcast.mock.calls.find((c) => c[0] === "meeting_minute_live");
    expect(call?.[1]).toMatchObject({
      task_id: "task-1",
      meeting_id: meetingId,
      seq: 3,
      speaker_agent_id: "a-1",
      speaker_name: "Lead",
      message_type: "chat",
      content: "Ship the cache 🚀",
    });
  });

  it("persists the entry exactly once and keeps content intact", () => {
    const tools = makeTools(db, broadcast);
    const meetingId = tools.beginMeetingMinutes("task-1", "planned", 1, "Kickoff");
    tools.appendMeetingMinuteEntry(meetingId, 1, agent, "en", "chat", "Multi-byte 한국어 🚀", null);
    const rows = db.prepare("SELECT content FROM meeting_minute_entries WHERE meeting_id = ?").all(meetingId) as Array<{
      content: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Multi-byte 한국어 🚀");
  });

  it("broadcasts meeting_finished with status on finish", () => {
    const tools = makeTools(db, broadcast);
    const meetingId = tools.beginMeetingMinutes("task-1", "review", 1, "Review");
    broadcast.mockClear();
    tools.finishMeetingMinutes(meetingId, "completed");
    const call = broadcast.mock.calls.find((c) => c[0] === "meeting_finished");
    expect(call?.[1]).toMatchObject({ task_id: "task-1", meeting_id: meetingId, status: "completed" });
  });
});
