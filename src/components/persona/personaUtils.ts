import type { PersonaProfile } from "../../types";
import type { UiLanguage } from "../../i18n";

/** Code-point-safe truncate so emoji / CJK never split mid-character on any OS. */
export function truncateCp(value: string, max: number): string {
  const cps = [...(value ?? "")];
  return cps.length <= max ? value : `${cps.slice(0, max).join("")}…`;
}

/** Pick a localized string from a {ko,en,ja,zh} JSON blob (lang then en then any). */
export function pickPersonaI18n(lang: UiLanguage, jsonStr: string | null | undefined): string {
  if (!jsonStr) return "";
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return "";
  }
  if (!obj || typeof obj !== "object") return "";
  for (const key of [lang, "en", "ja", "ko", "zh"]) {
    const v = obj[key as string];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function personaDisplayName(lang: UiLanguage, p: PersonaProfile): string {
  if (lang === "ja" && p.name_ja) return p.name_ja;
  if (lang === "ko" && p.name_ko) return p.name_ko;
  if (lang === "zh" && p.name_zh) return p.name_zh;
  return p.name || "";
}

export function parseTags(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export type PersonaCategoryKey =
  | "founder"
  | "finance"
  | "marketing"
  | "programming"
  | "legal"
  | "tax"
  | "accounting"
  | "management"
  | "design"
  | "general";

export const PERSONA_CATEGORY_ORDER: PersonaCategoryKey[] = [
  "founder",
  "finance",
  "marketing",
  "programming",
  "legal",
  "tax",
  "accounting",
  "management",
  "design",
  "general",
];

const CATEGORY_LABELS: Record<PersonaCategoryKey, { ja: string; en: string; emoji: string }> = {
  founder: { ja: "創業者・ビジョナリー", en: "Founders", emoji: "🚀" },
  finance: { ja: "投資・ファイナンス", en: "Finance", emoji: "💰" },
  marketing: { ja: "マーケター", en: "Marketing", emoji: "📣" },
  programming: { ja: "プログラマー", en: "Programming", emoji: "💻" },
  legal: { ja: "弁護士・法律家", en: "Legal", emoji: "⚖️" },
  tax: { ja: "税務", en: "Tax", emoji: "🧾" },
  accounting: { ja: "会計", en: "Accounting", emoji: "📊" },
  management: { ja: "プロ経営者", en: "Management", emoji: "👔" },
  design: { ja: "デザイナー", en: "Design", emoji: "🎨" },
  general: { ja: "その他・自作", en: "Custom", emoji: "🎭" },
};

export function categoryLabel(category: string, lang: UiLanguage): string {
  const c = CATEGORY_LABELS[category as PersonaCategoryKey];
  if (!c) return category;
  const name = lang === "ja" ? c.ja : c.en;
  return `${c.emoji} ${name}`;
}
