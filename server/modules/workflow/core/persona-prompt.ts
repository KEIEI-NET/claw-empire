import type { DatabaseSync } from "node:sqlite";

type DbLike = Pick<DatabaseSync, "prepare">;

/** Minimal shape needed from an agent row to resolve its identity block. */
export interface PersonaAgentLike {
  personality?: string | null;
  persona_profile_id?: string | null;
  persona_enabled?: number | null;
}

interface PersonaRow {
  name?: string | null;
  name_ko?: string | null;
  name_ja?: string | null;
  name_zh?: string | null;
  traits_i18n?: string | null;
}

// Localized guardrail appended to every persona block so the model keeps
// professional competence per role and reflects only the persona's style.
const PERSONA_GUARDRAIL: Record<string, string> = {
  ja: "※専門能力と成果物の正確性は役割・スキル通りに保ち、反映するのは上記のスタイル（口調・価値観・意思決定の傾き）のみ。",
  en: "Note: keep professional competence and output accuracy per role/skills; reflect only the style above (tone, values, decision-making tilt).",
  zh: "注：保持与角色/技能一致的专业能力与产出准确性，仅体现上述风格（语气、价值观、决策倾向）。",
  ko: "참고: 전문 능력과 산출물의 정확성은 역할/스킬대로 유지하고, 위 스타일(어조·가치관·의사결정 성향)만 반영하세요.",
};

function guardrail(lang: string): string {
  return PERSONA_GUARDRAIL[lang] ?? PERSONA_GUARDRAIL.en;
}

/** Pick a string from a {ko,en,ja,zh} JSON blob, preferring lang then en, then any. */
function pickI18n(lang: string, jsonStr: string | null | undefined): string {
  if (!jsonStr) return "";
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (!obj || typeof obj !== "object") return "";
  for (const key of [lang, "en", "ja", "ko", "zh"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function personaName(lang: string, p: PersonaRow): string {
  if (lang === "ja" && p.name_ja) return p.name_ja;
  if (lang === "ko" && p.name_ko) return p.name_ko;
  if (lang === "zh" && p.name_zh) return p.name_zh;
  // English / unknown lang: use the canonical (English) name only.
  return p.name || "";
}

// Memoized global switch — it only changes via explicit admin action, so we
// avoid re-querying settings on every prompt build (N agents per meeting).
// Call invalidatePersonaInjectionCache() after updating the setting.
let _globalSwitchCache: boolean | null = null;

export function invalidatePersonaInjectionCache(): void {
  _globalSwitchCache = null;
}

/** Layer ③: global master switch. Default ON when the setting is absent. */
export function isPersonaInjectionEnabled(db: DbLike): boolean {
  if (_globalSwitchCache !== null) return _globalSwitchCache;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'personaInjectionEnabled'").get() as
    | { value?: unknown }
    | undefined;
  let result = true;
  if (row && row.value != null) {
    const raw = String(row.value).trim();
    let parsedBool: boolean | null = null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "boolean") parsedBool = parsed;
    } catch {
      /* not JSON */
    }
    if (parsedBool !== null) {
      result = parsedBool;
    } else {
      const lower = raw.toLowerCase();
      result = lower !== "false" && lower !== "0" && lower !== "off";
    }
  }
  _globalSwitchCache = result;
  return result;
}

/**
 * Resolve the persona prompt block for an agent, honoring the 3-layer OFF control:
 *   ③ global switch off  → ""
 *   ② agent toggle off   → ""
 *   ① persona is NULL/'base' / missing / disabled / empty traits → ""
 * Otherwise returns "[Persona] <name>\n<traits(lang)>\n<guardrail(lang)>".
 */
export function buildPersonaPromptBlock(db: DbLike, agent: PersonaAgentLike | undefined, lang: string): string {
  if (!agent) return "";
  if (!isPersonaInjectionEnabled(db)) return ""; // ③
  if (Number(agent.persona_enabled ?? 1) === 0) return ""; // ②
  const id = agent.persona_profile_id;
  if (!id || id === "base") return ""; // ①
  const p = db.prepare("SELECT * FROM persona_profiles WHERE id = ? AND enabled = 1").get(id) as
    | (PersonaRow & Record<string, unknown>)
    | undefined;
  if (!p) return "";
  const traits = pickI18n(lang, p.traits_i18n ?? null);
  if (!traits) return "";
  return [`[Persona] ${personaName(lang, p)}`, traits, guardrail(lang)].filter(Boolean).join("\n");
}

/**
 * Combined identity block: the agent's free-text personality plus its persona
 * block. Drop-in replacement for the old `agent.personality ? "Personality: ..." : ""`.
 */
export function buildAgentIdentityBlock(db: DbLike, agent: PersonaAgentLike | undefined, lang: string): string {
  const personality = typeof agent?.personality === "string" ? agent.personality.trim() : "";
  return [personality ? `Personality: ${personality}` : "", buildPersonaPromptBlock(db, agent, lang)]
    .filter(Boolean)
    .join("\n");
}
