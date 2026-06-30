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

// Tool/stream noise some CLI providers (e.g. codex) emit even in noTools mode.
// Mirrors the leader-side normalizeConversationReply patterns, scoped to what a
// short subordinate take can contain.
const TOOL_NOISE_PATTERNS: RegExp[] = [
  // A single JSON object carrying a tool/stream "type" field, with the field at
  // ANY position (codex emits {"workdir":...,"type":"tool_use"} — type not first).
  // [^{}\n] bounds the block to one object on one line → no ReDoS, no cross-object span.
  /\{[^{}\n]*"type"\s*:\s*"(?:step_finish|step-finish|tool_use|tool_result|thinking|reasoning|text|content)"[^{}\n]*\}/gm,
  /\[(?:tool|result|output|spawn_agent|agent_done|one-shot-error)[^\]]*\]/gi,
  /^\[(?:init|usage|mcp|thread|reasoning|stdout|stderr|copilot|antigravity)\][^\n]*$/gim,
];

/** True when the text still looks like a raw JSON / structured tool payload. */
function looksLikeStructuredPayload(text: string): boolean {
  const s = text.trim();
  if (s.startsWith("{")) {
    if (s.endsWith("}")) {
      try {
        JSON.parse(s);
        return true; // valid JSON object → not prose
      } catch {
        /* fall through to the shape heuristic */
      }
    }
    // Opens like a JSON object with a quoted key, e.g. truncated {"workdir":"/tmp…
    if (/^\{\s*"[\w-]+"\s*:/.test(s)) return true;
  }
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      JSON.parse(s);
      return true;
    } catch {
      /* not valid JSON array prose */
    }
  }
  return false;
}

/**
 * Reduce a raw one-shot reply to a clean plain-text take, or "" when nothing
 * usable remains. Strips tool/stream noise, drops bracket-only lines, collapses
 * whitespace, rejects residual JSON payloads, and code-point-safely caps length.
 */
export function sanitizeReflectionText(raw: string | null | undefined, maxChars = 320): string {
  let text = (raw ?? "").trim();
  if (!text) return "";
  text = text.replace(/^"(.*)"$/s, "$1"); // unwrap a fully-quoted string
  for (const re of TOOL_NOISE_PATTERNS) text = text.replace(re, " ");
  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[{}[\],]+$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || looksLikeStructuredPayload(text)) return "";
  const chars = [...text];
  if (chars.length > maxChars) text = chars.slice(0, maxChars - 1).join("").trimEnd() + "…";
  return text;
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
    // Skip injection on empty/failed runs OR raw tool/JSON output — keep the
    // minutes readable rather than persisting a provider's structured noise.
    const text = sanitizeReflectionText(run?.text);
    if (!text) return null;
    return { subordinate, text };
  }

  return { runSubordinateReflection };
}
