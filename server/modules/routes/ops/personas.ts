import type { Express, Request, Response } from "express";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";

interface RegisterPersonaRoutesOptions {
  app: Express;
  db: DatabaseSync;
  nowMs: () => number;
  runInTransaction: (fn: () => void) => void;
}

// Category values mirror the CHECK constraint on persona_profiles.category
// and the PersonaCategory unions in persona-data.ts / src/types.
const ALLOWED_CATEGORIES = [
  "base",
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
] as const;
type PersonaCategory = (typeof ALLOWED_CATEGORIES)[number];

// Length limits (counted in Unicode code points, not UTF-16 units, so emoji
// and CJK never break and never truncate mid-character on any OS).
const LIMIT_NAME = 80;
const LIMIT_ONE_LINER = 200;
const LIMIT_TRAITS = 2400;
const LIMIT_BACKGROUND = 2400;
const LIMIT_EMOJI_CP = 8; // allow ZWJ / VS16 emoji sequences
const MAX_TAGS = 12;
const LIMIT_TAG = 40;

/** Code-point-safe clamp: never splits a surrogate pair (emoji-safe, OS-independent). */
function clampText(value: unknown, max: number): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("");
}

function isCategory(v: unknown): v is PersonaCategory {
  return typeof v === "string" && (ALLOWED_CATEGORIES as readonly string[]).includes(v);
}

type LocalizedInput = { ko?: unknown; en?: unknown; ja?: unknown; zh?: unknown };

/** Normalize a localized {ko,en,ja,zh} object into a JSON string, clamping each language. */
function normalizeI18n(value: unknown, perLangLimit: number): string {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const lang of ["ko", "en", "ja", "zh"] as const) {
      const raw = (value as LocalizedInput)[lang];
      if (typeof raw === "string" && raw.trim()) {
        out[lang] = clampText(raw.trim(), perLangLimit);
      }
    }
  } else if (typeof value === "string" && value.trim()) {
    // Bare string is treated as the English form.
    out.en = clampText(value.trim(), perLangLimit);
  }
  return JSON.stringify(out);
}

function normalizeTags(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  const tags = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => clampText(t.trim(), LIMIT_TAG))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  return JSON.stringify(tags);
}

function normalizeEmoji(value: unknown, fallback = "🎭"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return clampText(value.trim(), LIMIT_EMOJI_CP);
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

export function registerPersonaRoutes({ app, db, nowMs, runInTransaction }: RegisterPersonaRoutesOptions): void {
  const readPersona = (id: string) =>
    db.prepare("SELECT * FROM persona_profiles WHERE id = ?").get(id) as Record<string, unknown> | undefined;

  // ── List (optionally filtered by category) ──
  app.get("/api/personas", (req: Request, res: Response) => {
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const rows = isCategory(category)
      ? db
          .prepare("SELECT * FROM persona_profiles WHERE enabled = 1 AND category = ? ORDER BY sort_order, name")
          .all(category)
      : db.prepare("SELECT * FROM persona_profiles WHERE enabled = 1 ORDER BY sort_order, name").all();
    res.json({ ok: true, personas: rows });
  });

  // ── Detail ──
  app.get("/api/personas/:id", (req: Request, res: Response) => {
    const row = readPersona(String(req.params.id ?? ""));
    if (!row) return res.status(404).json({ error: "persona_not_found" });
    res.json({ ok: true, persona: row });
  });

  // ── Create (custom) ──
  app.post("/api/personas", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? clampText(body.name.trim(), LIMIT_NAME) : "";
    if (!name) return res.status(400).json({ error: "name_required" });

    const category: PersonaCategory = isCategory(body.category) && body.category !== "base" ? body.category : "general";
    const now = nowMs();
    const id = `persona-${randomUUID()}`;

    db.prepare(
      `
        INSERT INTO persona_profiles (
          id, category, is_base, is_preset, enabled, sort_order,
          name, name_ko, name_ja, name_zh,
          one_liner_i18n, background_i18n, traits_i18n,
          avatar_emoji, accent_color, tags_json, created_at, updated_at
        ) VALUES (?, ?, 0, 0, 1, 99, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      category,
      name,
      typeof body.name_ko === "string" ? clampText(body.name_ko.trim(), LIMIT_NAME) : "",
      typeof body.name_ja === "string" ? clampText(body.name_ja.trim(), LIMIT_NAME) : "",
      typeof body.name_zh === "string" ? clampText(body.name_zh.trim(), LIMIT_NAME) : "",
      normalizeI18n(body.one_liner, LIMIT_ONE_LINER),
      normalizeI18n(body.background, LIMIT_BACKGROUND),
      normalizeI18n(body.traits, LIMIT_TRAITS),
      normalizeEmoji(body.avatar_emoji),
      isHexColor(body.accent_color) ? (body.accent_color as string).trim() : "#a855f7",
      normalizeTags(body.tags),
      now,
      now,
    );
    res.json({ ok: true, id, persona: readPersona(id) });
  });

  // ── Update (custom only; presets/base are read-only — duplicate to edit) ──
  app.put("/api/personas/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const row = readPersona(id);
    if (!row) return res.status(404).json({ error: "persona_not_found" });
    if (Number(row.is_base) === 1 || Number(row.is_preset) === 1) {
      return res.status(409).json({ error: "preset_protected", hint: "duplicate_to_edit" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: SQLInputValue[] = [];
    const set = (col: string, val: SQLInputValue) => {
      sets.push(`${col} = ?`);
      params.push(val);
    };

    if (typeof body.name === "string") {
      const name = clampText(body.name.trim(), LIMIT_NAME);
      if (!name) return res.status(400).json({ error: "name_required" });
      set("name", name);
    }
    if (typeof body.name_ko === "string") set("name_ko", clampText(body.name_ko.trim(), LIMIT_NAME));
    if (typeof body.name_ja === "string") set("name_ja", clampText(body.name_ja.trim(), LIMIT_NAME));
    if (typeof body.name_zh === "string") set("name_zh", clampText(body.name_zh.trim(), LIMIT_NAME));
    if (isCategory(body.category) && body.category !== "base") set("category", body.category);
    if ("one_liner" in body) set("one_liner_i18n", normalizeI18n(body.one_liner, LIMIT_ONE_LINER));
    if ("background" in body) set("background_i18n", normalizeI18n(body.background, LIMIT_BACKGROUND));
    if ("traits" in body) set("traits_i18n", normalizeI18n(body.traits, LIMIT_TRAITS));
    if ("avatar_emoji" in body) set("avatar_emoji", normalizeEmoji(body.avatar_emoji));
    if (isHexColor(body.accent_color)) set("accent_color", (body.accent_color as string).trim());
    if ("tags" in body) set("tags_json", normalizeTags(body.tags));
    if ("enabled" in body) set("enabled", Number(body.enabled) === 0 ? 0 : 1);

    if (sets.length === 0) return res.status(400).json({ error: "no_fields_to_update" });

    set("updated_at", nowMs());
    params.push(id);
    db.prepare(`UPDATE persona_profiles SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    res.json({ ok: true, persona: readPersona(id) });
  });

  // ── Duplicate (preset or custom) → new editable custom ──
  app.post("/api/personas/:id/duplicate", (req: Request, res: Response) => {
    const src = readPersona(String(req.params.id ?? ""));
    if (!src) return res.status(404).json({ error: "persona_not_found" });

    const now = nowMs();
    const id = `persona-${randomUUID()}`;
    const srcCategory = String(src.category ?? "general");
    const category = srcCategory === "base" ? "general" : srcCategory;
    const baseName = String(src.name ?? "Persona");
    const copyName = clampText(`${baseName} (copy)`, LIMIT_NAME);

    db.prepare(
      `
        INSERT INTO persona_profiles (
          id, category, is_base, is_preset, enabled, sort_order,
          name, name_ko, name_ja, name_zh,
          one_liner_i18n, background_i18n, traits_i18n,
          avatar_emoji, accent_color, tags_json, created_at, updated_at
        ) VALUES (?, ?, 0, 0, 1, 99, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      id,
      category,
      copyName,
      String(src.name_ko ?? ""),
      src.name_ja ? clampText(`${String(src.name_ja)}（コピー）`, LIMIT_NAME) : "",
      String(src.name_zh ?? ""),
      String(src.one_liner_i18n ?? "{}"),
      String(src.background_i18n ?? "{}"),
      String(src.traits_i18n ?? "{}"),
      normalizeEmoji(src.avatar_emoji),
      isHexColor(src.accent_color) ? (src.accent_color as string) : "#a855f7",
      String(src.tags_json ?? "[]"),
      now,
      now,
    );
    res.json({ ok: true, id, persona: readPersona(id) });
  });

  // ── Delete (custom only; reassign agents back to 素/NULL first) ──
  app.delete("/api/personas/:id", (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const row = readPersona(id);
    if (!row) return res.status(404).json({ error: "persona_not_found" });
    if (Number(row.is_base) === 1 || Number(row.is_preset) === 1) {
      return res.status(409).json({ error: "preset_protected" });
    }

    runInTransaction(() => {
      // Delete integrity: agents using this persona fall back to 素 (NULL).
      db.prepare("UPDATE agents SET persona_profile_id = NULL WHERE persona_profile_id = ?").run(id);
      db.prepare("DELETE FROM persona_profiles WHERE id = ?").run(id);
    });
    res.json({ ok: true });
  });
}
