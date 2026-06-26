import { del, post, put, request } from "./core";

import type { PersonaProfile } from "../types";

export async function getPersonas(category?: string): Promise<PersonaProfile[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const j = await request<{ ok: boolean; personas: PersonaProfile[] }>(`/api/personas${qs}`);
  return j.personas ?? [];
}

export async function getPersona(id: string): Promise<PersonaProfile | null> {
  const j = await request<{ ok: boolean; persona: PersonaProfile }>(`/api/personas/${id}`);
  return j.persona ?? null;
}

export interface PersonaWriteInput {
  name: string;
  name_ja?: string;
  name_ko?: string;
  name_zh?: string;
  category?: string;
  avatar_emoji?: string;
  accent_color?: string;
  tags?: string[];
  one_liner?: { ja?: string; en?: string; ko?: string; zh?: string };
  background?: { ja?: string; en?: string; ko?: string; zh?: string };
  traits?: { ja?: string; en?: string; ko?: string; zh?: string };
}

export async function createPersona(input: PersonaWriteInput): Promise<{ ok: boolean; id: string; persona: PersonaProfile }> {
  return post("/api/personas", input) as Promise<{ ok: boolean; id: string; persona: PersonaProfile }>;
}

export async function updatePersona(
  id: string,
  input: Partial<PersonaWriteInput> & { enabled?: number },
): Promise<{ ok: boolean; persona: PersonaProfile }> {
  return put(`/api/personas/${id}`, input) as Promise<{ ok: boolean; persona: PersonaProfile }>;
}

export async function duplicatePersona(id: string): Promise<{ ok: boolean; id: string; persona: PersonaProfile }> {
  return post(`/api/personas/${id}/duplicate`) as Promise<{ ok: boolean; id: string; persona: PersonaProfile }>;
}

export async function deletePersona(id: string): Promise<{ ok: boolean }> {
  return del(`/api/personas/${id}`) as Promise<{ ok: boolean }>;
}
