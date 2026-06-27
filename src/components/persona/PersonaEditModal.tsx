import { useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../api";
import type { PersonaProfile } from "../../types";
import { PERSONA_CATEGORY_ORDER, categoryLabel, parseTags } from "./personaUtils";

interface PersonaEditModalProps {
  // null = create new; a profile = edit existing (must be a custom, non-preset)
  persona: PersonaProfile | null;
  onClose: () => void;
  onSaved: () => void;
}

function parseI18nField(jsonStr: string | null | undefined): { ja: string; en: string } {
  if (!jsonStr) return { ja: "", en: "" };
  try {
    const o = JSON.parse(jsonStr) as Record<string, string>;
    return { ja: o.ja ?? "", en: o.en ?? "" };
  } catch {
    return { ja: "", en: "" };
  }
}

export default function PersonaEditModal({ persona, onClose, onSaved }: PersonaEditModalProps) {
  const { t, language } = useI18n();
  const isEdit = persona !== null;

  const initial = useMemo(() => {
    const oneLiner = parseI18nField(persona?.one_liner_i18n);
    const traits = parseI18nField(persona?.traits_i18n);
    const background = parseI18nField(persona?.background_i18n);
    return {
      name: persona?.name ?? "",
      name_ja: persona?.name_ja ?? "",
      category: (persona && persona.category !== "base" ? persona.category : "general") as string,
      avatar_emoji: persona?.avatar_emoji ?? "🎭",
      accent_color: persona?.accent_color ?? "#a855f7",
      tags: parseTags(persona?.tags_json).join(", "),
      one_liner_ja: oneLiner.ja,
      one_liner_en: oneLiner.en,
      traits_ja: traits.ja,
      traits_en: traits.en,
      background_ja: background.ja,
      background_en: background.en,
    };
  }, [persona]);

  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError(t({ ko: "이름은 필수입니다.", en: "Name is required.", ja: "名前は必須です。", zh: "名称为必填项。" }));
      return;
    }
    setSaving(true);
    setError(null);
    const payload: api.PersonaWriteInput = {
      name: form.name.trim(),
      name_ja: form.name_ja.trim(),
      category: form.category,
      avatar_emoji: form.avatar_emoji.trim() || "🎭",
      accent_color: form.accent_color,
      tags: form.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      one_liner: { ja: form.one_liner_ja.trim(), en: form.one_liner_en.trim() },
      traits: { ja: form.traits_ja.trim(), en: form.traits_en.trim() },
      background: { ja: form.background_ja.trim(), en: form.background_en.trim() },
    };
    try {
      if (isEdit && persona) {
        await api.updatePersona(persona.id, payload);
      } else {
        await api.createPersona(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-sm";
  const inputStyle = {
    background: "var(--th-bg-surface)",
    color: "var(--th-text-primary)",
    border: "1px solid var(--th-card-border)",
  } as const;
  const labelCls = "block text-xs mb-1 font-medium";
  const labelStyle = { color: "var(--th-text-secondary)" } as const;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl p-5"
        style={{ background: "var(--th-bg-sidebar)", border: "1px solid var(--th-card-border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: "var(--th-text-heading)" }}>
            {isEdit
              ? t({ ko: "페르소나 편집", en: "Edit Persona", ja: "ペルソナを編集", zh: "编辑人格" })
              : t({ ko: "새 페르소나", en: "New Persona", ja: "新規ペルソナ", zh: "新建人格" })}
          </h3>
          <button onClick={onClose} style={{ color: "var(--th-text-muted)" }}>
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "이름 (영문)", en: "Name (EN)", ja: "名前（英）", zh: "名称（英）" })} *
            </label>
            <input className={inputCls} style={inputStyle} value={form.name} onChange={(e) => update({ name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "이름 (일문)", en: "Name (JA)", ja: "名前（日）", zh: "名称（日）" })}
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              value={form.name_ja}
              onChange={(e) => update({ name_ja: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "카테고리", en: "Category", ja: "カテゴリ", zh: "类别" })}
            </label>
            <select
              aria-label={t({ ko: "카테고리", en: "Category", ja: "カテゴリ", zh: "类别" })}
              className={inputCls}
              style={inputStyle}
              value={form.category}
              onChange={(e) => update({ category: e.target.value })}
            >
              {PERSONA_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c, language)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="w-20">
              <label className={labelCls} style={labelStyle}>
                {t({ ko: "이모지", en: "Emoji", ja: "絵文字", zh: "表情" })}
              </label>
              <input
                className={inputCls}
                style={inputStyle}
                value={form.avatar_emoji}
                onChange={(e) => update({ avatar_emoji: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className={labelCls} style={labelStyle}>
                {t({ ko: "강조색", en: "Accent", ja: "アクセント色", zh: "强调色" })}
              </label>
              <input
                type="color"
                aria-label={t({ ko: "강조색", en: "Accent color", ja: "アクセント色", zh: "强调色" })}
                className="w-full h-[34px] rounded-lg"
                style={{ background: "var(--th-bg-surface)", border: "1px solid var(--th-card-border)" }}
                value={form.accent_color}
                onChange={(e) => update({ accent_color: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label className={labelCls} style={labelStyle}>
            {t({ ko: "태그 (쉼표 구분)", en: "Tags (comma-separated)", ja: "タグ（カンマ区切り）", zh: "标签（逗号分隔）" })}
          </label>
          <input className={inputCls} style={inputStyle} value={form.tags} onChange={(e) => update({ tags: e.target.value })} />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-3">
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "한 줄 소개 (일)", en: "One-liner (JA)", ja: "一行紹介（日）", zh: "一句话（日）" })}
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              value={form.one_liner_ja}
              onChange={(e) => update({ one_liner_ja: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "한 줄 소개 (영)", en: "One-liner (EN)", ja: "一行紹介（英）", zh: "一句话（英）" })}
            </label>
            <input
              className={inputCls}
              style={inputStyle}
              value={form.one_liner_en}
              onChange={(e) => update({ one_liner_en: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-3">
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "특성 (일)", en: "Traits (JA)", ja: "特性（日）", zh: "特性（日）" })}
            </label>
            <textarea
              rows={6}
              className={`${inputCls} resize-none`}
              style={inputStyle}
              placeholder={"口調: ...\n価値観: ...\n意思決定: ...\n口グセ/名言: ...\n注意: 役割通りの正確性は維持、スタイルのみ反映。"}
              value={form.traits_ja}
              onChange={(e) => update({ traits_ja: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>
              {t({ ko: "특성 (영)", en: "Traits (EN)", ja: "特性（英）", zh: "特性（英）" })}
            </label>
            <textarea
              rows={6}
              className={`${inputCls} resize-none`}
              style={inputStyle}
              placeholder={"Tone: ...\nValues: ...\nDecisions: ...\nSignature: ...\nGuardrail: keep accuracy per role; reflect style only."}
              value={form.traits_en}
              onChange={(e) => update({ traits_en: e.target.value })}
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 text-xs" style={{ color: "#f87171" }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm"
            style={{ background: "var(--th-bg-surface)", color: "var(--th-text-secondary)" }}
          >
            {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white"
            style={{ background: "var(--th-accent, #a855f7)", opacity: saving ? 0.6 : 1 }}
          >
            {saving
              ? t({ ko: "저장 중…", en: "Saving…", ja: "保存中…", zh: "保存中…" })
              : t({ ko: "저장", en: "Save", ja: "保存", zh: "保存" })}
          </button>
        </div>
      </div>
    </div>
  );
}
