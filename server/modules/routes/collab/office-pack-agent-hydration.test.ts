import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  hydrateOfficePackAgentFromSettings,
  syncOfficePackAgentsForPack,
  syncOfficePackAgentsFromProfiles,
} from "./office-pack-agent-hydration.ts";

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL,
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '🏢',
      color TEXT NOT NULL DEFAULT '#64748b',
      description TEXT,
      prompt TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL,
      department_id TEXT,
      role TEXT NOT NULL,
      acts_as_planning_leader INTEGER NOT NULL DEFAULT 0,
      cli_provider TEXT,
      avatar_emoji TEXT NOT NULL DEFAULT '🤖',
      personality TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      stats_tasks_done INTEGER DEFAULT 0,
      stats_xp INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      oauth_account_id TEXT,
      api_provider_id TEXT,
      api_model TEXT,
      sprite_number INTEGER,
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      cli_model TEXT,
      cli_reasoning_level TEXT,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );
  `);
  return db;
}

// Schema variant that includes the persona columns added by the later migration,
// plus workflow_pack_key — i.e. a current production-shaped agents table.
function createDbWithPersona(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL,
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '🏢',
      color TEXT NOT NULL DEFAULT '#64748b',
      description TEXT,
      prompt TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL,
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      department_id TEXT,
      workflow_pack_key TEXT NOT NULL DEFAULT 'development',
      role TEXT NOT NULL,
      acts_as_planning_leader INTEGER NOT NULL DEFAULT 0,
      cli_provider TEXT,
      avatar_emoji TEXT NOT NULL DEFAULT '🤖',
      sprite_number INTEGER,
      personality TEXT,
      persona_profile_id TEXT,
      persona_enabled INTEGER NOT NULL DEFAULT 1 CHECK(persona_enabled IN (0,1)),
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      stats_tasks_done INTEGER DEFAULT 0,
      stats_xp INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      cli_model TEXT,
      cli_reasoning_level TEXT,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );
  `);
  return db;
}

let db: DatabaseSync | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("hydrateOfficePackAgentFromSettings", () => {
  it("officePackProfiles에 있는 seed 에이전트를 DB에 보강한다", () => {
    db = createDb();
    const profiles = {
      video_preprod: {
        departments: [
          {
            id: "planning",
            name: "Planning",
            name_ko: "기획",
            name_ja: "企画",
            name_zh: "企划",
            icon: "🎬",
            color: "#f59e0b",
            sort_order: 1,
            created_at: 1700000000000,
          },
        ],
        agents: [
          {
            id: "video_preprod-seed-1",
            name: "Rian",
            name_ko: "리안",
            name_ja: "リアン",
            name_zh: "里安",
            department_id: "planning",
            role: "team_leader",
            acts_as_planning_leader: 1,
            cli_provider: "claude",
            cli_model: "claude-opus-4-6",
            avatar_emoji: "🎬",
            sprite_number: 8,
            personality: "planning lead",
            created_at: 1700000000001,
          },
        ],
      },
    };
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(JSON.stringify(profiles));

    const hydrated = hydrateOfficePackAgentFromSettings(db, "video_preprod-seed-1", () => 1700000000999);
    expect(hydrated?.id).toBe("video_preprod-seed-1");
    expect(hydrated?.name).toBe("Rian");
    expect(hydrated?.department_id).toBe("planning");
    expect(hydrated?.cli_provider).toBe("claude");
    expect(hydrated?.cli_model).toBe("claude-opus-4-6");
    expect((hydrated as unknown as { sprite_number?: number }).sprite_number).toBe(8);
    expect((hydrated as unknown as { acts_as_planning_leader?: number }).acts_as_planning_leader).toBe(1);

    const dept = db.prepare("SELECT id, name_ko FROM departments WHERE id = 'planning'").get() as
      | { id: string; name_ko: string }
      | undefined;
    expect(dept).toEqual({ id: "planning", name_ko: "기획" });
  });

  it("설정에 없는 agent id는 null을 반환한다", () => {
    db = createDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(JSON.stringify({}));

    const hydrated = hydrateOfficePackAgentFromSettings(db, "missing-agent", () => 1700000000999);
    expect(hydrated).toBeNull();
  });

  it("profiles 전체를 미리 sync하면 seed 에이전트가 agents 테이블에 적재된다", () => {
    db = createDb();
    const profiles = {
      novel: {
        departments: [
          {
            id: "design",
            name: "Story Design",
            name_ko: "스토리팀",
            icon: "✍️",
            color: "#7c3aed",
            sort_order: 1,
          },
        ],
        agents: [
          {
            id: "novel-seed-1",
            name: "Luna",
            name_ko: "루나",
            department_id: "design",
            role: "team_leader",
            acts_as_planning_leader: 1,
            cli_provider: "claude",
            avatar_emoji: "✍️",
          },
        ],
      },
    };

    const result = syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000002000);
    expect(result.agentsSynced).toBeGreaterThan(0);

    const row = db
      .prepare("SELECT id, name, department_id, acts_as_planning_leader FROM agents WHERE id = 'novel-seed-1'")
      .get() as { id: string; name: string; department_id: string | null; acts_as_planning_leader: number } | undefined;
    expect(row).toEqual({
      id: "novel-seed-1",
      name: "Luna",
      department_id: "design",
      acts_as_planning_leader: 1,
    });
  });

  it("pack 단위 sync는 선택한 팩만 hydrate한다", () => {
    db = createDb();
    const profiles = {
      novel: {
        departments: [{ id: "design", name: "Story Design", name_ko: "스토리팀", icon: "✍️", color: "#7c3aed" }],
        agents: [
          {
            id: "novel-seed-1",
            name: "Luna",
            name_ko: "루나",
            department_id: "design",
            role: "team_leader",
            cli_provider: "claude",
            avatar_emoji: "✍️",
          },
        ],
      },
      report: {
        departments: [{ id: "planning", name: "Report", name_ko: "리포트팀", icon: "📚", color: "#f59e0b" }],
        agents: [
          {
            id: "report-seed-1",
            name: "Sage",
            name_ko: "세이지",
            department_id: "planning",
            role: "team_leader",
            cli_provider: "claude",
            avatar_emoji: "📚",
          },
        ],
      },
    };

    const result = syncOfficePackAgentsForPack(db, profiles, "novel", () => 1700000003000);
    expect(result.agentsSynced).toBeGreaterThan(0);

    const novel = db.prepare("SELECT id FROM agents WHERE id = 'novel-seed-1'").get() as { id?: string } | undefined;
    const report = db.prepare("SELECT id FROM agents WHERE id = 'report-seed-1'").get() as { id?: string } | undefined;

    expect(novel?.id).toBe("novel-seed-1");
    expect(report).toBeUndefined();
  });
});

type PersonaRow = { persona_profile_id: string | null; persona_enabled: number };

function readPersona(database: DatabaseSync, agentId: string): PersonaRow | undefined {
  return database.prepare("SELECT persona_profile_id, persona_enabled FROM agents WHERE id = ?").get(agentId) as
    | PersonaRow
    | undefined;
}

function packWithAgent(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    novel: {
      departments: [{ id: "design", name: "Story", name_ko: "스토리", icon: "✍️", color: "#7c3aed" }],
      agents: [
        {
          id: "p-seed-1",
          name: "Luna",
          name_ko: "루나",
          department_id: "design",
          role: "senior",
          cli_provider: "claude",
          avatar_emoji: "✍️",
          ...extra,
        },
      ],
    },
  };
}

describe("persona propagation (Phase 6)", () => {
  it("hydration carries a pack-declared persona into the agents table", () => {
    db = createDbWithPersona();
    const profiles = packWithAgent({ persona_profile_id: "elon-musk", persona_enabled: 1 });
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(JSON.stringify(profiles));

    const hydrated = hydrateOfficePackAgentFromSettings(db, "p-seed-1", () => 1700000000999);
    expect(hydrated?.id).toBe("p-seed-1");
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: "elon-musk", persona_enabled: 1 });
  });

  it("normalizes a 'base' persona to NULL and defaults persona_enabled to 1", () => {
    db = createDbWithPersona();
    const profiles = packWithAgent({ persona_profile_id: "base" });
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(JSON.stringify(profiles));

    hydrateOfficePackAgentFromSettings(db, "p-seed-1", () => 1700000000999);
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: null, persona_enabled: 1 });
  });

  it("honors persona_enabled=0 (overlay disabled) on a declared persona", () => {
    db = createDbWithPersona();
    const profiles = packWithAgent({ persona_profile_id: "steve-jobs", persona_enabled: 0 });

    const result = syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000002000);
    expect(result.agentsSynced).toBeGreaterThan(0);
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: "steve-jobs", persona_enabled: 0 });
  });

  it("upsert preserves a user's manual persona when the pack ships none", () => {
    db = createDbWithPersona();
    const profiles = packWithAgent({}); // no persona declared
    // First sync hydrates the agent as base.
    syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000002000);
    // User manually assigns a persona via the agents CRUD path.
    db.prepare("UPDATE agents SET persona_profile_id = 'warren-buffett', persona_enabled = 1 WHERE id = 'p-seed-1'").run();

    // Re-sync (e.g. pack profile re-saved) must NOT wipe the manual assignment.
    syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000003000);
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: "warren-buffett", persona_enabled: 1 });
  });

  it("upsert preserves a user's deliberate persona_enabled=0 when the pack ships none", () => {
    db = createDbWithPersona();
    const profiles = packWithAgent({}); // no persona declared
    syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000002000);
    // User assigns a persona then disables the overlay (layer-2 OFF).
    db.prepare("UPDATE agents SET persona_profile_id = 'warren-buffett', persona_enabled = 0 WHERE id = 'p-seed-1'").run();

    // Re-sync must keep BOTH the assignment and the disabled toggle.
    syncOfficePackAgentsFromProfiles(db, profiles, () => 1700000003000);
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: "warren-buffett", persona_enabled: 0 });
  });

  it("a pack-declared persona still overrides both id and enabled on re-sync", () => {
    db = createDbWithPersona();
    syncOfficePackAgentsFromProfiles(db, packWithAgent({}), () => 1700000002000);
    db.prepare("UPDATE agents SET persona_profile_id = 'warren-buffett', persona_enabled = 0 WHERE id = 'p-seed-1'").run();

    // Pack now declares a persona with enabled=1 — it wins over the user's state.
    syncOfficePackAgentsFromProfiles(
      db,
      packWithAgent({ persona_profile_id: "steve-jobs", persona_enabled: 1 }),
      () => 1700000003000,
    );
    expect(readPersona(db, "p-seed-1")).toEqual({ persona_profile_id: "steve-jobs", persona_enabled: 1 });
  });

  it("upsert lets a pack-declared persona override the existing assignment", () => {
    db = createDbWithPersona();
    syncOfficePackAgentsFromProfiles(db, packWithAgent({ persona_profile_id: "elon-musk" }), () => 1700000002000);
    expect(readPersona(db, "p-seed-1")?.persona_profile_id).toBe("elon-musk");

    // Pack now declares a different persona — it wins on re-sync.
    syncOfficePackAgentsFromProfiles(db, packWithAgent({ persona_profile_id: "steve-jobs" }), () => 1700000003000);
    expect(readPersona(db, "p-seed-1")?.persona_profile_id).toBe("steve-jobs");
  });

  it("ignores persona fields on a legacy schema without persona columns", () => {
    db = createDb(); // no persona columns
    const profiles = packWithAgent({ persona_profile_id: "elon-musk", persona_enabled: 0 });
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(JSON.stringify(profiles));

    // Must not throw despite the declared persona the schema can't store.
    const hydrated = hydrateOfficePackAgentFromSettings(db, "p-seed-1", () => 1700000000999);
    expect(hydrated?.id).toBe("p-seed-1");
  });
});
