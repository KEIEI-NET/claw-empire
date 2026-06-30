import type { MeetingMinuteEntry } from "../../types";

/**
 * Phase 10: opt-in live meeting minutes. The backend streams `meeting_minute_live`
 * events (full entry text) as each turn is recorded. This module holds the pure
 * reducer logic for the in-progress live feed so it can be unit-tested without a
 * socket. Completed meetings remain sourced from the polled API; the live feed
 * only carries entries for meetings still in progress.
 */

export interface LiveMinuteEvent {
  task_id: string | null;
  meeting_id: string;
  seq: number;
  speaker_agent_id: string | null;
  speaker_name: string;
  department_name: string | null;
  role_label: string | null;
  message_type: string;
  content: string;
  created_at: number;
}

export type LiveMinuteEntry = Omit<MeetingMinuteEntry, "id">;

export interface LiveMeetingGroup {
  meetingId: string;
  entries: LiveMinuteEntry[];
}

export const MAX_LIVE_MINUTE_ENTRIES = 200;

/**
 * Append a streamed entry to the live feed, ignoring events for other tasks and
 * de-duplicating by (meeting_id, seq). Returns the same reference when nothing
 * changes so React can skip re-renders.
 */
export function appendLiveMinute(
  feed: LiveMinuteEntry[],
  event: LiveMinuteEvent,
  taskId: string,
): LiveMinuteEntry[] {
  if (event.task_id !== taskId) return feed;
  if (feed.some((e) => e.meeting_id === event.meeting_id && e.seq === event.seq)) return feed;
  const entry: LiveMinuteEntry = {
    meeting_id: event.meeting_id,
    seq: event.seq,
    speaker_agent_id: event.speaker_agent_id,
    speaker_name: event.speaker_name,
    department_name: event.department_name,
    role_label: event.role_label,
    message_type: event.message_type,
    content: event.content,
    created_at: event.created_at,
  };
  const next = [...feed, entry];
  return next.length > MAX_LIVE_MINUTE_ENTRIES ? next.slice(next.length - MAX_LIVE_MINUTE_ENTRIES) : next;
}

/** Drop a meeting's live entries once it finishes (the API now holds the confirmed copy). */
export function dropMeetingFromLive(feed: LiveMinuteEntry[], meetingId: string): LiveMinuteEntry[] {
  const next = feed.filter((e) => e.meeting_id !== meetingId);
  return next.length === feed.length ? feed : next;
}

/** Group the flat feed by meeting, preserving arrival order and sorting entries by seq. */
export function groupLiveByMeeting(feed: LiveMinuteEntry[]): LiveMeetingGroup[] {
  const order: string[] = [];
  const byMeeting = new Map<string, LiveMinuteEntry[]>();
  for (const e of feed) {
    if (!byMeeting.has(e.meeting_id)) {
      byMeeting.set(e.meeting_id, []);
      order.push(e.meeting_id);
    }
    byMeeting.get(e.meeting_id)!.push(e);
  }
  return order.map((meetingId) => ({
    meetingId,
    entries: [...byMeeting.get(meetingId)!].sort((a, b) => a.seq - b.seq),
  }));
}
