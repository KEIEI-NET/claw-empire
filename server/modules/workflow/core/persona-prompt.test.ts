import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema } from "../../bootstrap/schema/base-schema.ts";
import { applyTaskSchemaMigrations } from "../../bootstrap/schema/task-schema-migrations.ts";
import { seedDefaultPersonas } from "../../bootstrap/schema/persona-seeds.ts";
import {
  buildAgentIdentityBlock,
  buildPersonaPromptBlock,
  isPersonaInjectionEnabled,
  invalidatePersonaInjectionCache,
} from "./persona-prompt.ts";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyTaskSchemaMigrations(db);
  seedDefaultPersonas(db);
  return db;
}

function agent(over: Record<string, unknown> = {}) {
  return { personality: "几帳面なシニア開発者", persona_profile_id: null, persona_enabled: 1, ...over } as any;
}

describe("persona-prompt", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    invalidatePersonaInjectionCache();
    db = freshDb();
  });

  it("returns only personality when persona is NULL (素)", () => {
    expect(buildAgentIdentityBlock(db, agent(), "ja")).toBe("Personality: 几帳面なシニア開発者");
  });

  it("returns empty for the 'base' sentinel (layer 1)", () => {
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "base" }), "ja")).toBe("");
  });

  it("injects the resolved-language persona block with guardrail", () => {
    const out = buildPersonaPromptBlock(db, agent({ persona_profile_id: "warren-buffett" }), "ja");
    expect(out).toContain("[Persona] ウォーレン・バフェット");
    expect(out).toContain("口調:");
    expect(out).toContain("※専門能力と成果物の正確性は役割");
  });

  it("uses the English name and traits for lang=en", () => {
    const out = buildPersonaPromptBlock(db, agent({ persona_profile_id: "warren-buffett" }), "en");
    expect(out).toContain("[Persona] Warren Buffett");
    expect(out).toContain("Tone:");
    expect(out).toContain("Note: keep professional competence");
  });

  it("respects the per-agent toggle (layer 2)", () => {
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "warren-buffett", persona_enabled: 0 }), "ja")).toBe(
      "",
    );
  });

  it("respects the global switch (layer 3) and re-enables after invalidation", () => {
    db.prepare("INSERT INTO settings (key,value) VALUES ('personaInjectionEnabled','false')").run();
    invalidatePersonaInjectionCache();
    expect(isPersonaInjectionEnabled(db)).toBe(false);
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "warren-buffett" }), "ja")).toBe("");

    db.prepare("UPDATE settings SET value='true' WHERE key='personaInjectionEnabled'").run();
    invalidatePersonaInjectionCache();
    expect(isPersonaInjectionEnabled(db)).toBe(true);
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "warren-buffett" }), "ja").length).toBeGreaterThan(0);
  });

  it("parses boolean/string forms of the global switch", () => {
    // Settings are stored bare (JSON.stringify(false) => "false"), so test those forms.
    for (const v of ["false", "0", "off"]) {
      db.prepare("INSERT INTO settings (key,value) VALUES ('personaInjectionEnabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v);
      invalidatePersonaInjectionCache();
      expect(isPersonaInjectionEnabled(db)).toBe(false);
    }
    for (const v of ["true", "1", "on"]) {
      db.prepare("INSERT INTO settings (key,value) VALUES ('personaInjectionEnabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v);
      invalidatePersonaInjectionCache();
      expect(isPersonaInjectionEnabled(db)).toBe(true);
    }
  });

  it("defaults to ON when the setting is absent", () => {
    expect(isPersonaInjectionEnabled(db)).toBe(true);
  });

  it("returns empty (no throw) for a missing/deleted profile id", () => {
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "ghost-xyz" }), "ja")).toBe("");
  });

  it("returns empty for an empty traits object {} (custom persona)", () => {
    db.prepare(
      "INSERT INTO persona_profiles (id,category,name,traits_i18n) VALUES ('c-empty','general','Empty','{}')",
    ).run();
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "c-empty" }), "ja")).toBe("");
  });

  it("never throws on malformed traits_i18n JSON", () => {
    db.prepare(
      "INSERT INTO persona_profiles (id,category,name,traits_i18n) VALUES ('c-bad','general','Bad','{not json')",
    ).run();
    expect(() => buildPersonaPromptBlock(db, agent({ persona_profile_id: "c-bad" }), "ja")).not.toThrow();
    expect(buildPersonaPromptBlock(db, agent({ persona_profile_id: "c-bad" }), "ja")).toBe("");
  });

  it("emits persona only when personality is empty", () => {
    const out = buildAgentIdentityBlock(db, agent({ personality: "", persona_profile_id: "steve-jobs" }), "ja");
    expect(out).not.toContain("Personality:");
    expect(out).toContain("[Persona]");
  });

  it("returns '' when both personality and persona are empty (OFF-time parity)", () => {
    expect(buildAgentIdentityBlock(db, agent({ personality: "" }), "ja")).toBe("");
  });

  // The exact prompt fragment the codebase emitted before personas existed.
  // Phase 6 contract: whenever injection is OFF (any of the 3 layers, or base),
  // buildAgentIdentityBlock must reproduce this byte-for-byte.
  const legacyIdentity = (personality: string | null | undefined): string => {
    const p = typeof personality === "string" ? personality.trim() : "";
    return p ? `Personality: ${p}` : "";
  };

  describe("legacy prompt parity when persona injection is OFF", () => {
    const cases: Array<{ label: string; over: Record<string, unknown> }> = [
      { label: "base sentinel", over: { persona_profile_id: "base" } },
      { label: "NULL persona", over: { persona_profile_id: null } },
      { label: "per-agent toggle off (layer 2)", over: { persona_profile_id: "steve-jobs", persona_enabled: 0 } },
      { label: "missing/deleted profile id", over: { persona_profile_id: "does-not-exist" } },
    ];

    for (const lang of ["ja", "en", "ko", "zh"]) {
      for (const { label, over } of cases) {
        it(`matches legacy output — ${label} [${lang}], with personality`, () => {
          const a = agent(over);
          expect(buildAgentIdentityBlock(db, a, lang)).toBe(legacyIdentity(a.personality));
        });
        it(`matches legacy output — ${label} [${lang}], no personality`, () => {
          const a = agent({ ...over, personality: "" });
          expect(buildAgentIdentityBlock(db, a, lang)).toBe(legacyIdentity(a.personality));
        });
      }
    }

    it("matches legacy output when the global switch (layer 3) is OFF, even with a valid persona", () => {
      db.prepare("INSERT INTO settings (key, value) VALUES ('personaInjectionEnabled', 'false')").run();
      invalidatePersonaInjectionCache();
      const a = agent({ persona_profile_id: "steve-jobs", persona_enabled: 1 });
      expect(buildAgentIdentityBlock(db, a, "ja")).toBe(legacyIdentity(a.personality));
      expect(buildPersonaPromptBlock(db, a, "ja")).toBe("");
    });
  });
});
