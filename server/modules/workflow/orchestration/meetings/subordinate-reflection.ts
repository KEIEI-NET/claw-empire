import type { MeetingPromptOptions } from "../../core/conversation-types.ts";

/**
 * Phase 9 (Model A): in-meeting subordinate reflection.
 *
 * After a leader states an action item in a CEO-office meeting, the leader's
 * best available subordinate gives a short on-the-ground reality check. The take
 * is written to the meeting minutes (attributed to the subordinate) and fed back
 * into the transcript so the consensus reflects it — WITHOUT spawning a real CLI
 * child task (that async path is Model B / a later phase). Reuses runAgentOneShot
 * (noTools) and buildMeetingPrompt, so the subordinate's persona (Phase 7) applies.
 */

type DbLike = { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown } };

export interface ReflectionAgent {
  id: string;
  department_id: string | null;
  role: string;
  [key: string]: unknown;
}

// Memoized settings switch (mirrors isPersonaInjectionEnabled). Default ON.
let _reflectionSwitchCache: boolean | null = null;

export function invalidateMeetingReflectionCache(): void {
  _reflectionSwitchCache = null;
}

/** Master switch (settings key `meetingDelegateReflectionEnabled`). Default ON. */
export function isMeetingDelegateReflectionEnabled(db: DbLike): boolean {
  if (_reflectionSwitchCache !== null) return _reflectionSwitchCache;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'meetingDelegateReflectionEnabled'").get() as
    | { value?: unknown }
    | undefined;
  let result = true;
  if (row && row.value != null) {
    const raw = String(row.value).trim().toLowerCase();
    result = raw !== "false" && raw !== "0" && raw !== "off";
  }
  _reflectionSwitchCache = result;
  return result;
}

/**
 * Pick the best subordinate (non-leader) of a department for meeting reflection.
 * Mirrors findBestSubordinate's priority (status idle>break>working, role
 * senior>junior>intern) but excludes offline agents — an offline teammate should
 * not speak in a live meeting.
 */
export function selectMeetingSubordinate(
  db: DbLike,
  deptId: string | null,
  excludeLeaderId: string,
): ReflectionAgent | null {
  if (!deptId) return null;
  const rows = db
    .prepare(
      `SELECT * FROM agents
       WHERE department_id = ? AND id != ? AND role != 'team_leader' AND status != 'offline'
       ORDER BY
         CASE status WHEN 'idle' THEN 0 WHEN 'break' THEN 1 WHEN 'working' THEN 2 ELSE 3 END,
         CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 WHEN 'intern' THEN 2 ELSE 3 END`,
    )
    .all(deptId, excludeLeaderId) as ReflectionAgent[];
  return rows[0] ?? null;
}

interface ReflectionRunnerDeps {
  db: DbLike;
  buildMeetingPrompt: (agent: ReflectionAgent, opts: MeetingPromptOptions) => string;
  runAgentOneShot: (
    agent: ReflectionAgent,
    prompt: string,
    opts: { projectPath?: string; timeoutMs?: number; noTools?: boolean },
  ) => Promise<{ text?: string; error?: string } | null>;
  getAgentDisplayName: (agent: ReflectionAgent, lang: string) => string;
}

export interface ReflectionRequest {
  leader: ReflectionAgent;
  leaderStatement: string;
  taskTitle: string;
  taskDescription: string | null;
  workflowPackKey: string | null;
  round: number;
  lang: string;
  projectPath?: string;
  timeoutMs?: number;
}

export interface ReflectionResult {
  subordinate: ReflectionAgent;
  text: string;
}

const DEFAULT_REFLECTION_TIMEOUT_MS = 45_000;

export function createSubordinateReflectionRunner(deps: ReflectionRunnerDeps) {
  const { db, buildMeetingPrompt, runAgentOneShot, getAgentDisplayName } = deps;

  async function runSubordinateReflection(req: ReflectionRequest): Promise<ReflectionResult | null> {
    if (!isMeetingDelegateReflectionEnabled(db)) return null;
    const subordinate = selectMeetingSubordinate(db, req.leader.department_id, req.leader.id);
    if (!subordinate) return null;

    const prompt = buildMeetingPrompt(subordinate, {
      meetingType: "planned",
      round: req.round,
      taskTitle: req.taskTitle,
      taskDescription: req.taskDescription,
      workflowPackKey: req.workflowPackKey,
      transcript: [
        {
          speaker_agent_id: req.leader.id,
          speaker: getAgentDisplayName(req.leader, req.lang),
          content: req.leaderStatement,
        },
      ] as MeetingPromptOptions["transcript"],
      turnObjective:
        "Your team leader proposed the action above. As the specialist who will actually execute it, add ONE concrete on-the-ground reality check — a risk, a dependency, or a quick feasibility confirmation. Do not restate the plan.",
      stanceHint: "Speak from hands-on execution experience. Be specific and brief (1-2 sentences).",
      lang: req.lang,
    });

    const run = await runAgentOneShot(subordinate, prompt, {
      projectPath: req.projectPath,
      timeoutMs: req.timeoutMs ?? DEFAULT_REFLECTION_TIMEOUT_MS,
      noTools: true,
    });
    const text = (run?.text ?? "").trim();
    if (!text) return null; // skip injection on empty/failed runs — keep the meeting clean
    return { subordinate, text };
  }

  return { runSubordinateReflection };
}
