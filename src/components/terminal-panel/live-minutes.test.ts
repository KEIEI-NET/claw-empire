import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_MINUTE_ENTRIES,
  appendLiveMinute,
  dropMeetingFromLive,
  groupLiveByMeeting,
  type LiveMinuteEntry,
  type LiveMinuteEvent,
} from "./live-minutes";

function event(over: Partial<LiveMinuteEvent> = {}): LiveMinuteEvent {
  return {
    task_id: "task-1",
    meeting_id: "m-1",
    seq: 1,
    speaker_agent_id: "a-1",
    speaker_name: "Lead",
    department_name: "Dev",
    role_label: "Team Leader",
    message_type: "chat",
    content: "Let's ship it 🚀",
    created_at: 1000,
    ...over,
  };
}

describe("appendLiveMinute", () => {
  it("appends an entry for the matching task", () => {
    const feed = appendLiveMinute([], event(), "task-1");
    expect(feed).toHaveLength(1);
    expect(feed[0].content).toBe("Let's ship it 🚀");
    expect(feed[0]).not.toHaveProperty("id");
    expect(feed[0]).not.toHaveProperty("task_id");
  });

  it("ignores events for a different task (same reference returned)", () => {
    const feed: LiveMinuteEntry[] = [];
    const next = appendLiveMinute(feed, event({ task_id: "other" }), "task-1");
    expect(next).toBe(feed);
  });

  it("de-duplicates by meeting_id + seq (same reference returned)", () => {
    const feed = appendLiveMinute([], event({ seq: 3 }), "task-1");
    const again = appendLiveMinute(feed, event({ seq: 3 }), "task-1");
    expect(again).toBe(feed);
    expect(again).toHaveLength(1);
  });

  it("keeps distinct seqs", () => {
    let feed: LiveMinuteEntry[] = [];
    feed = appendLiveMinute(feed, event({ seq: 1 }), "task-1");
    feed = appendLiveMinute(feed, event({ seq: 2 }), "task-1");
    expect(feed).toHaveLength(2);
  });

  it("caps the feed length", () => {
    let feed: LiveMinuteEntry[] = [];
    for (let i = 0; i < MAX_LIVE_MINUTE_ENTRIES + 25; i++) {
      feed = appendLiveMinute(feed, event({ seq: i }), "task-1");
    }
    expect(feed).toHaveLength(MAX_LIVE_MINUTE_ENTRIES);
    // oldest dropped, newest kept
    expect(feed[feed.length - 1].seq).toBe(MAX_LIVE_MINUTE_ENTRIES + 24);
  });
});

describe("dropMeetingFromLive", () => {
  it("removes only the finished meeting's entries", () => {
    let feed: LiveMinuteEntry[] = [];
    feed = appendLiveMinute(feed, event({ meeting_id: "m-1", seq: 1 }), "task-1");
    feed = appendLiveMinute(feed, event({ meeting_id: "m-2", seq: 1 }), "task-1");
    const next = dropMeetingFromLive(feed, "m-1");
    expect(next).toHaveLength(1);
    expect(next[0].meeting_id).toBe("m-2");
  });

  it("returns the same reference when nothing matches", () => {
    const feed = appendLiveMinute([], event(), "task-1");
    expect(dropMeetingFromLive(feed, "nope")).toBe(feed);
  });
});

describe("groupLiveByMeeting", () => {
  it("groups by meeting in arrival order and sorts entries by seq", () => {
    let feed: LiveMinuteEntry[] = [];
    feed = appendLiveMinute(feed, event({ meeting_id: "m-1", seq: 2 }), "task-1");
    feed = appendLiveMinute(feed, event({ meeting_id: "m-2", seq: 1 }), "task-1");
    feed = appendLiveMinute(feed, event({ meeting_id: "m-1", seq: 1 }), "task-1");
    const groups = groupLiveByMeeting(feed);
    expect(groups.map((g) => g.meetingId)).toEqual(["m-1", "m-2"]);
    expect(groups[0].entries.map((e) => e.seq)).toEqual([1, 2]);
  });
});
