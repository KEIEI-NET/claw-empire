import type { DatabaseSync } from "node:sqlite";
import { PERSONA_PRESETS, PERSONA_CATEGORY_ACCENT } from "./persona-data.ts";

type DbLike = Pick<DatabaseSync, "prepare">;

/**
 * Seed the master-0 persona catalog. Idempotent: presets are upserted so
 * edits to the seed data propagate on next boot, while user-created custom
 * personas (is_preset=0) are never touched. Localized text is stored as
 * {ja,en} JSON in the *_i18n columns (ko/zh fall back to en via pickLang).
 */
export function seedDefaultPersonas(db: DbLike): void {
  const now = Date.now();
  const upsert = db.prepare(
    `
    INSERT INTO persona_profiles (
      id, category, is_base, is_preset, enabled, sort_order,
      name, name_ja, one_liner_i18n, traits_i18n,
      avatar_emoji, accent_color, tags_json, created_at, updated_at
    ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      is_base = excluded.is_base,
      is_preset = 1,
      enabled = 1,
      sort_order = excluded.sort_order,
      name = excluded.name,
      name_ja = excluded.name_ja,
      one_liner_i18n = excluded.one_liner_i18n,
      traits_i18n = excluded.traits_i18n,
      avatar_emoji = excluded.avatar_emoji,
      accent_color = excluded.accent_color,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `,
  );

  PERSONA_PRESETS.forEach((p, index) => {
    upsert.run(
      p.id,
      p.category,
      p.isBase ? 1 : 0,
      index, // sort_order follows declaration order (base first)
      p.name,
      p.nameJa,
      JSON.stringify({ ja: p.oneLiner.ja, en: p.oneLiner.en }),
      JSON.stringify({ ja: p.traits.ja, en: p.traits.en }),
      p.emoji,
      PERSONA_CATEGORY_ACCENT[p.category],
      JSON.stringify(p.tags),
      now,
      now,
    );
  });
}
