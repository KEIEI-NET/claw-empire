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

const CATEGORY_LABELS: Record<PersonaCategoryKey, { ja: string; en: string; ko: string; zh: string; emoji: string }> = {
  founder: { ja: "創業者・ビジョナリー", en: "Founders", ko: "창업자·비저너리", zh: "创始人·愿景家", emoji: "🚀" },
  finance: { ja: "投資・ファイナンス", en: "Finance", ko: "투자·금융", zh: "投资·金融", emoji: "💰" },
  marketing: { ja: "マーケター", en: "Marketing", ko: "마케터", zh: "营销", emoji: "📣" },
  programming: { ja: "プログラマー", en: "Programming", ko: "프로그래머", zh: "程序员", emoji: "💻" },
  legal: { ja: "弁護士・法律家", en: "Legal", ko: "변호사·법조인", zh: "律师·法律", emoji: "⚖️" },
  tax: { ja: "税務", en: "Tax", ko: "세무", zh: "税务", emoji: "🧾" },
  accounting: { ja: "会計", en: "Accounting", ko: "회계", zh: "会计", emoji: "📊" },
  management: { ja: "プロ経営者", en: "Management", ko: "전문 경영인", zh: "职业经理人", emoji: "👔" },
  design: { ja: "デザイナー", en: "Design", ko: "디자이너", zh: "设计师", emoji: "🎨" },
  general: { ja: "その他・自作", en: "Custom", ko: "기타·직접 생성", zh: "其他·自建", emoji: "🎭" },
};

export function categoryLabel(category: string, lang: UiLanguage): string {
  const c = CATEGORY_LABELS[category as PersonaCategoryKey];
  if (!c) return category;
  const name = lang === "ja" ? c.ja : lang === "ko" ? c.ko : lang === "zh" ? c.zh : c.en;
  return `${c.emoji} ${name}`;
}
