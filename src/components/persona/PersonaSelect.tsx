import { useMemo } from "react";
import { useI18n } from "../../i18n";
import { usePersonas } from "./usePersonas";
import {
  PERSONA_CATEGORY_ORDER,
  categoryLabel,
  parseTags,
  personaDisplayName,
  pickPersonaI18n,
  truncateCp,
} from "./personaUtils";

interface PersonaSelectProps {
  value: string | null | undefined; // persona_profile_id
  enabled: number; // persona_enabled (0|1)
  onChange: (personaProfileId: string | null) => void;
  onToggle: (enabled: number) => void;
  disabled?: boolean;
}

export default function PersonaSelect({ value, enabled, onChange, onToggle, disabled }: PersonaSelectProps) {
  const { t, language } = useI18n();
  const { personas, loading } = usePersonas();

  const isBase = !value || value === "base";
  const selected = useMemo(() => personas.find((p) => p.id === value) ?? null, [personas, value]);

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

      {!isBase && selected && (
        <div
          className="mt-2 rounded-lg p-2.5 text-xs"
          style={{
            background: "var(--th-bg-surface)",
            border: `1px solid ${selected.accent_color || "var(--th-card-border)"}`,
            opacity: applyOn ? 1 : 0.55,
          }}
        >
          <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--th-text-heading)" }}>
            <span>{selected.avatar_emoji}</span>
            <span>{personaDisplayName(language, selected)}</span>
            {!applyOn && (
              <span className="ml-1 px-1 rounded text-[10px]" style={{ background: "var(--th-bg-sidebar)" }}>
                OFF
              </span>
            )}
          </div>
          {pickPersonaI18n(language, selected.one_liner_i18n) && (
            <div className="mt-0.5" style={{ color: "var(--th-text-secondary)" }}>
              {pickPersonaI18n(language, selected.one_liner_i18n)}
            </div>
          )}
          {pickPersonaI18n(language, selected.traits_i18n) && (
            <div className="mt-1 whitespace-pre-line" style={{ color: "var(--th-text-muted)" }}>
              {truncateCp(pickPersonaI18n(language, selected.traits_i18n), 160)}
            </div>
          )}
          {parseTags(selected.tags_json).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {parseTags(selected.tags_json)
                .slice(0, 5)
                .map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                    style={{ background: "var(--th-bg-sidebar)", color: "var(--th-text-muted)" }}
                  >
                    {tag}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
