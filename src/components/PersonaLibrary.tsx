import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../api";
import type { Agent, PersonaProfile } from "../types";
import { usePersonas, invalidatePersonaCache } from "./persona/usePersonas";
import {
  PERSONA_CATEGORY_ORDER,
  categoryLabel,
  parseTags,
  personaDisplayName,
  pickPersonaI18n,
  truncateCp,
} from "./persona/personaUtils";
import PersonaEditModal from "./persona/PersonaEditModal";

interface PersonaLibraryProps {
  agents: Agent[];
}

export default function PersonaLibrary({ agents }: PersonaLibraryProps) {
  const { t, language } = useI18n();
  const { personas, loading, error, reload } = usePersonas();

  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<PersonaProfile | null>(null);
  const [editing, setEditing] = useState<PersonaProfile | null | "new">(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // agents assigned per persona id
  const assignedCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of agents) {
      if (a.persona_profile_id && a.persona_profile_id !== "base") {
        m[a.persona_profile_id] = (m[a.persona_profile_id] ?? 0) + 1;
      }
    }
    return m;
  }, [agents]);

  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of personas) {
      if (Number(p.is_base) === 1 || p.category === "base") continue;
      m[p.category] = (m[p.category] ?? 0) + 1;
    }
    return m;
  }, [personas]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return personas
      .filter((p) => Number(p.is_base) !== 1 && p.category !== "base")
      .filter((p) => activeCat === "all" || p.category === activeCat)
      .filter((p) => {
        if (!q) return true;
        const hay = `${p.name} ${p.name_ja ?? ""} ${pickPersonaI18n(language, p.one_liner_i18n)} ${parseTags(p.tags_json).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
  }, [personas, activeCat, search, language]);

  const afterMutation = async () => {
    invalidatePersonaCache();
    await reload();
  };

  const handleDuplicate = async (p: PersonaProfile) => {
    setBusyId(p.id);
    try {
      await api.duplicatePersona(p.id);
      await afterMutation();
    } catch (err) {
      console.error("duplicate failed", err);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await api.deletePersona(id);
      setConfirmDelete(null);
      await afterMutation();
    } catch (err) {
      console.error("delete failed", err);
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { key: string; label: string }[] = [
    { key: "all", label: t({ ko: "전체", en: "All", ja: "全部", zh: "全部" }) },
    ...PERSONA_CATEGORY_ORDER.filter((c) => (catCounts[c] ?? 0) > 0).map((c) => ({
      key: c,
      label: `${categoryLabel(c, language)} ${catCounts[c]}`,
    })),
  ];

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <input
          type="search"
          aria-label={t({ ko: "검색", en: "Search", ja: "検索", zh: "搜索" })}
          placeholder={t({ ko: "검색…", en: "Search…", ja: "検索…", zh: "搜索…" })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs rounded-lg px-3 py-1.5 text-sm"
          style={{ background: "var(--th-bg-surface)", color: "var(--th-text-primary)", border: "1px solid var(--th-card-border)" }}
        />
        <button
          onClick={() => setEditing("new")}
          className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: "var(--th-accent, #a855f7)" }}
        >
          ＋ {t({ ko: "새 페르소나", en: "New Persona", ja: "新規ペルソナ", zh: "新建人格" })}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveCat(tab.key)}
            className="px-2.5 py-1 rounded-full text-xs"
            style={{
              background: activeCat === tab.key ? "var(--th-accent, #a855f7)" : "var(--th-bg-surface)",
              color: activeCat === tab.key ? "#fff" : "var(--th-text-secondary)",
              border: "1px solid var(--th-card-border)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-sm mb-3" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "목록을 불러오지 못했습니다.", en: "Failed to load.", ja: "読み込みに失敗しました。", zh: "加载失败。" })}
        </div>
      )}
      {loading && personas.length === 0 && (
        <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "불러오는 중…", en: "Loading…", ja: "読み込み中…", zh: "加载中…" })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((p) => {
          const isPreset = Number(p.is_preset) === 1;
          const oneLiner = pickPersonaI18n(language, p.one_liner_i18n);
          const tags = parseTags(p.tags_json).slice(0, 4);
          const count = assignedCount[p.id] ?? 0;
          return (
            <div
              key={p.id}
              className="rounded-xl p-3.5 flex flex-col"
              style={{
                background: "var(--th-card-bg)",
                border: `1px solid var(--th-card-border)`,
                borderLeft: `3px solid ${p.accent_color || "var(--th-card-border)"}`,
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-2xl leading-none">{p.avatar_emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate" style={{ color: "var(--th-text-heading)" }}>
                    {personaDisplayName(language, p)}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: "var(--th-text-muted)" }}>
                    {categoryLabel(p.category, language)}
                    {count > 0 ? ` · 👥${count}` : ""}
                  </div>
                </div>
                {!isPreset && (
                  <span
                    className="text-[9px] px-1 py-0.5 rounded font-mono"
                    style={{ background: "var(--th-bg-surface)", color: "var(--th-text-muted)" }}
                  >
                    {t({ ko: "직접", en: "Custom", ja: "自作", zh: "自建" })}
                  </span>
                )}
              </div>

              {oneLiner && (
                <div className="text-xs mt-1.5" style={{ color: "var(--th-text-secondary)" }}>
                  {truncateCp(oneLiner, 60)}
                </div>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag, i) => (
                    <span
                      key={`${tag}-${i}`}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                      style={{ background: "var(--th-bg-surface)", color: "var(--th-text-muted)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-3 pt-2.5 text-xs" style={{ borderTop: "1px solid var(--th-card-border)" }}>
                <button onClick={() => setDetail(p)} style={{ color: "var(--th-text-secondary)" }}>
                  👁 {t({ ko: "상세", en: "Detail", ja: "詳細", zh: "详情" })}
                </button>
                <button
                  onClick={() => handleDuplicate(p)}
                  disabled={busyId === p.id}
                  style={{ color: "var(--th-text-secondary)" }}
                >
                  ⧉ {t({ ko: "복제", en: "Duplicate", ja: "複製", zh: "复制" })}
                </button>
                {!isPreset && (
                  <>
                    <button onClick={() => setEditing(p)} style={{ color: "var(--th-text-secondary)" }}>
                      ✏️ {t({ ko: "편집", en: "Edit", ja: "編集", zh: "编辑" })}
                    </button>
                    {confirmDelete === p.id ? (
                      <span className="ml-auto flex items-center gap-1">
                        <button onClick={() => handleDelete(p.id)} disabled={busyId === p.id} style={{ color: "#f87171" }}>
                          {t({ ko: "삭제", en: "Delete", ja: "削除", zh: "删除" })}
                        </button>
                        <button onClick={() => setConfirmDelete(null)} style={{ color: "var(--th-text-muted)" }}>
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(p.id)} className="ml-auto" style={{ color: "var(--th-text-muted)" }}>
                        🗑
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {visible.length === 0 && !loading && (
        <div className="text-sm mt-6 text-center" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "결과 없음", en: "No personas", ja: "該当なし", zh: "无结果" })}
        </div>
      )}

      {detail && <PersonaDetailModal persona={detail} onClose={() => setDetail(null)} />}
      {editing !== null && (
        <PersonaEditModal
          persona={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await afterMutation();
          }}
        />
      )}
    </div>
  );
}

function PersonaDetailModal({ persona, onClose }: { persona: PersonaProfile; onClose: () => void }) {
  const { t, language } = useI18n();
  const traits = pickPersonaI18n(language, persona.traits_i18n);
  const background = pickPersonaI18n(language, persona.background_i18n);
  const oneLiner = pickPersonaI18n(language, persona.one_liner_i18n);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-5"
        style={{ background: "var(--th-bg-sidebar)", border: `1px solid ${persona.accent_color || "var(--th-card-border)"}` }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-3xl">{persona.avatar_emoji}</span>
            <div>
              <div className="font-bold" style={{ color: "var(--th-text-heading)" }}>
                {personaDisplayName(language, persona)}
              </div>
              <div className="text-xs" style={{ color: "var(--th-text-muted)" }}>
                {categoryLabel(persona.category, language)}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--th-text-muted)" }}>
            ✕
          </button>
        </div>
        {oneLiner && (
          <div className="text-sm mb-2" style={{ color: "var(--th-text-secondary)" }}>
            {oneLiner}
          </div>
        )}
        {background && (
          <div className="text-xs mb-3 whitespace-pre-line" style={{ color: "var(--th-text-muted)" }}>
            {background}
          </div>
        )}
        {traits && (
          <div>
            <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--th-text-secondary)" }}>
              {t({ ko: "특성", en: "Traits", ja: "特性", zh: "特性" })}
            </div>
            <div className="text-xs whitespace-pre-line" style={{ color: "var(--th-text-primary)" }}>
              {traits}
            </div>
          </div>
        )}
        {parseTags(persona.tags_json).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {parseTags(persona.tags_json).map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: "var(--th-bg-surface)", color: "var(--th-text-muted)" }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
