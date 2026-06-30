import { describe, expect, it, vi } from "vitest";
import { createMeetingPromptTools } from "./meeting-prompt-tools.ts";
import { invalidatePersonaInjectionCache } from "./persona-prompt.ts";
import type { AgentRow } from "./conversation-types.ts";

function createAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    name: "DORO",
    name_ko: "도로롱",
    role: "junior",
    personality: null,
    status: "idle",
    department_id: "design",
    current_task_id: null,
    avatar_emoji: "🎨",
    cli_provider: "claude",
    oauth_account_id: null,
    api_provider_id: null,
    api_model: null,
    cli_model: null,
    cli_reasoning_level: null,
    ...overrides,
  };
}

function createTools() {
  return createMeetingPromptTools({
    db: { prepare: () => ({ get: () => undefined, run: () => undefined, all: () => [] }) } as any,
    getDeptName: () => "Design",
    getDeptRoleConstraint: () => "",
    getRoleLabel: () => "Junior",
    getRecentConversationContext: () => "",
    getAgentDisplayName: (agent) => agent.name,
    formatMeetingTranscript: () => "",
    compactTaskDescriptionForMeeting: () => "",
    normalizeMeetingLang: () => "en",
    localeInstruction: () => "Respond in English.",
    resolveLang: () => "en",
  });
}

describe("buildDirectReplyPrompt", () => {
  it("includes character persona block when personality exists", () => {
    const tools = createTools();
    const agent = createAgent({
      personality: "Playful design specialist. Call CEO '대표님' and keep warm expressive tone.",
    });
    const built = tools.buildDirectReplyPrompt(agent, "Can you help me now?", "chat");
    expect(built.prompt).toContain("[Character Persona - Highest Priority]");
    expect(built.prompt).toContain("Playful design specialist");
    expect(built.prompt).toContain("Stay in character consistently");
    expect(built.prompt).toContain("Keep the reply aligned with the Character Persona.");
  });

  it("omits persona block when personality is empty", () => {
    const tools = createTools();
    const agent = createAgent({ personality: null });
    const built = tools.buildDirectReplyPrompt(agent, "Can you help me now?", "chat");
    expect(built.prompt).not.toContain("[Character Persona - Highest Priority]");
    expect(built.prompt).not.toContain("Keep the reply aligned with the Character Persona.");
  });
});

describe("buildMeetingPrompt", () => {
  it("passes workflow pack key into department name lookup", () => {
    const getDeptName = vi.fn(() => "씬 엔진팀");
    const tools = createMeetingPromptTools({
      db: { prepare: () => ({ get: () => undefined, run: () => undefined, all: () => [] }) } as any,
      getDeptName,
      getDeptRoleConstraint: () => "",
      getRoleLabel: () => "팀장",
      getRecentConversationContext: () => "",
      getAgentDisplayName: (agent) => agent.name_ko,
      formatMeetingTranscript: () => "",
      compactTaskDescriptionForMeeting: () => "",
      normalizeMeetingLang: () => "ko",
      localeInstruction: () => "한국어로 응답하세요.",
      resolveLang: () => "ko",
    });
    const prompt = tools.buildMeetingPrompt(createAgent({ department_id: "dev", role: "team_leader" }), {
      meetingType: "planned",
      round: 1,
      taskTitle: "영상 제작",
      taskDescription: "킥오프",
      workflowPackKey: "video_preprod",
      transcript: [],
      turnObjective: "킥오프",
      lang: "ko",
    });
    expect(getDeptName).toHaveBeenCalledWith("dev", "video_preprod");
    expect(prompt).toContain("Remotion");
  });
});

describe("buildMeetingPrompt persona injection (Phase 7)", () => {
  const baseOpts = {
    meetingType: "planned" as const,
    round: 1,
    taskTitle: "Launch",
    taskDescription: "kickoff",
    transcript: [],
    turnObjective: "Open the meeting.",
    lang: "en",
  };

  it("includes the free-text personality as a Character Persona block in meeting speech", () => {
    const tools = createTools();
    const prompt = tools.buildMeetingPrompt(
      createAgent({ role: "team_leader", personality: "Blunt risk-first CTO who pushes for evidence." }),
      baseOpts,
    );
    expect(prompt).toContain("[Character Persona - Highest Priority]");
    expect(prompt).toContain("Blunt risk-first CTO who pushes for evidence.");
    expect(prompt).toContain("Stay in character consistently throughout the meeting.");
  });

  it("omits the persona block when there is no personality and no persona profile", () => {
    const tools = createTools();
    const prompt = tools.buildMeetingPrompt(createAgent({ personality: null }), baseOpts);
    expect(prompt).not.toContain("[Character Persona - Highest Priority]");
    expect(prompt).not.toContain("[Persona]");
  });

  it("injects the persona profile name and traits from the DB into the meeting prompt", () => {
    invalidatePersonaInjectionCache();
    const personaRow = {
      name: "Steve Jobs",
      name_ja: "スティーブ・ジョブズ",
      traits_i18n: JSON.stringify({ en: "Demand insanely great work. Cut scope ruthlessly." }),
    };
    const tools = createMeetingPromptTools({
      db: {
        prepare: (sql: string) => ({
          get: () => (String(sql).includes("persona_profiles") ? personaRow : undefined),
          run: () => undefined,
          all: () => [],
        }),
      } as any,
      getDeptName: () => "Design",
      getDeptRoleConstraint: () => "",
      getRoleLabel: () => "Team Leader",
      getRecentConversationContext: () => "",
      getAgentDisplayName: (agent) => agent.name,
      formatMeetingTranscript: () => "",
      compactTaskDescriptionForMeeting: () => "",
      normalizeMeetingLang: () => "en",
      localeInstruction: () => "Respond in English.",
      resolveLang: () => "en",
    });
    const prompt = tools.buildMeetingPrompt(
      createAgent({ role: "team_leader", personality: null, persona_profile_id: "steve-jobs", persona_enabled: 1 }),
      baseOpts,
    );
    expect(prompt).toContain("[Character Persona - Highest Priority]");
    expect(prompt).toContain("[Persona] Steve Jobs");
    expect(prompt).toContain("insanely great work");
  });

  it("respects the per-agent toggle (layer 2): persona_enabled=0 suppresses the profile block", () => {
    invalidatePersonaInjectionCache();
    const personaRow = {
      name: "Steve Jobs",
      traits_i18n: JSON.stringify({ en: "Demand insanely great work." }),
    };
    const tools = createMeetingPromptTools({
      db: {
        prepare: (sql: string) => ({
          get: () => (String(sql).includes("persona_profiles") ? personaRow : undefined),
          run: () => undefined,
          all: () => [],
        }),
      } as any,
      getDeptName: () => "Design",
      getDeptRoleConstraint: () => "",
      getRoleLabel: () => "Team Leader",
      getRecentConversationContext: () => "",
      getAgentDisplayName: (agent) => agent.name,
      formatMeetingTranscript: () => "",
      compactTaskDescriptionForMeeting: () => "",
      normalizeMeetingLang: () => "en",
      localeInstruction: () => "Respond in English.",
      resolveLang: () => "en",
    });
    const prompt = tools.buildMeetingPrompt(
      createAgent({ role: "team_leader", personality: null, persona_profile_id: "steve-jobs", persona_enabled: 0 }),
      baseOpts,
    );
    expect(prompt).not.toContain("[Persona]");
    expect(prompt).not.toContain("[Character Persona - Highest Priority]");
  });
});
