import { useMemo } from "react";
import { useI18n, type UiLanguage } from "../../i18n";
import type { PersonaProfile } from "../../types";
import { usePersonas } from "./usePersonas";
import {
  PERSONA_CATEGORY_ORDER,
  categoryLabel,
  parseTags,
  personaDisplayName,
  pickPersonaI18n,
  truncateCp,
} from "./personaUtils";

function PersonaPreview({
  persona,
  applyOn,
  language,
}: {
  persona: PersonaProfile;
  applyOn: boolean;
  language: UiLanguage;
}) {
  const oneLiner = pickPersonaI18n(language, persona.one_liner_i18n);
  const traits = pickPersonaI18n(language, persona.traits_i18n);
  const tags = parseTags(persona.tags_json).slice(0, 5);
  return (
    <div
      className="mt-2 rounded-lg p-2.5 text-xs"
      style={{
        background: "var(--th-bg-surface)",
        border: `1px solid ${persona.accent_color || "var(--th-card-border)"}`,
        opacity: applyOn ? 1 : 0.55,
      }}
    >
      <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--th-text-heading)" }}>
        <span>{persona.avatar_emoji}</span>
        <span>{personaDisplayName(language, persona)}</span>
        {!applyOn && (
          <span className="ml-1 px-1 rounded text-[10px]" style={{ background: "var(--th-bg-sidebar)" }}>
            OFF
          </span>
        )}
      </div>
      {oneLiner && (
        <div className="mt-0.5" style={{ color: "var(--th-text-secondary)" }}>
          {oneLiner}
        </div>
      )}
      {traits && (
        <div className="mt-1 whitespace-pre-line" style={{ color: "var(--th-text-muted)" }}>
          {truncateCp(traits, 160)}
        </div>
      )}
      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((tag, i) => (
            <span
              key={`${tag}-${i}`}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{ background: "var(--th-bg-sidebar)", color: "var(--th-text-muted)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface PersonaSelectProps {
  value: string | null | undefined; // persona_profile_id
  enabled: number; // persona_enabled (0|1)
  onChange: (personaProfileId: string | null) => void;
  onToggle: (enabled: number) => void;
  disabled?: boolean;
}

export default function PersonaSelect({ value, enabled, onChange, onToggle, disabled }: PersonaSelectProps) {
  const { t, language } = useI18n();
  const { personas, loading, error } = usePersonas();

  const selected = useMemo(() => personas.find((p) => p.id === value) ?? null, [personas, value]);
  // Treat NULL/'base', and any id that no longer exists in the catalog (deleted
  // persona), as "素" so the controlled <select> always has a matching option.
  const isBase = !value || value === "base" || (!loading && !selected);

  const grouped = useMemo(() => {
    const byCat = new Map<string, typeof personas>();
    for (const p of personas) {
      if (Number(p.is_base) === 1 || p.category === "base") continue;
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    return byCat;
  }, [personas]);

  const applyOn = Number(enabled ?? 1) === 1;

  return (
    <div>
      <div className="flex items-center gap-2">
        <select
          aria-label={t({ ko: "페르소나 선택", en: "Select persona", ja: "ペルソナを選択", zh: "选择人格" })}
          value={isBase ? "" : (value as string)}
          disabled={disabled || loading}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1 rounded-lg px-2.5 py-1.5 text-sm"
          style={{
            background: "var(--th-bg-surface)",
            color: "var(--th-text-primary)",
            border: "1px solid var(--th-card-border)",
          }}
        >
          <option value="">{t({ ko: "소 (없음)", en: "None", ja: "素（なし）", zh: "无" })}</option>
          {PERSONA_CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat);
            if (!list || list.length === 0) return null;
            return (
              <optgroup key={cat} label={categoryLabel(cat, language)}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.avatar_emoji} {personaDisplayName(language, p)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        <label
          className="flex items-center gap-1.5 text-xs whitespace-nowrap select-none"
          style={{ color: isBase ? "var(--th-text-muted)" : "var(--th-text-secondary)", opacity: isBase ? 0.5 : 1 }}
          title={t({ ko: "페르소나 적용", en: "Apply persona", ja: "ペルソナを適用", zh: "应用人格" })}
        >
          <input
            type="checkbox"
            checked={applyOn}
            disabled={disabled || isBase}
            onChange={(e) => onToggle(e.target.checked ? 1 : 0)}
          />
          {t({ ko: "적용", en: "Apply", ja: "適用", zh: "应用" })}
        </label>
      </div>

      {error && (
        <div className="mt-1 text-[11px]" style={{ color: "var(--th-text-muted)" }}>
          {t({
            ko: "페르소나 목록을 불러오지 못했습니다.",
            en: "Failed to load personas.",
            ja: "ペルソナ一覧の読み込みに失敗しました。",
            zh: "无法加载人格列表。",
          })}
        </div>
      )}
      {!isBase && selected && <PersonaPreview persona={selected} applyOn={applyOn} language={language} />}
    </div>
  );
}
