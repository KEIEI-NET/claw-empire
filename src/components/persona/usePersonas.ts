import { useCallback, useEffect, useState } from "react";
import { getPersonas } from "../../api";
import type { PersonaProfile } from "../../types";

// Module-level cache so the catalog (admin-curated, rarely changing) is fetched
// once and shared across AgentCard badges, selectors, and the library.
let _cache: PersonaProfile[] | null = null;
let _inflight: Promise<PersonaProfile[]> | null = null;
const _subscribers = new Set<() => void>();

async function load(force = false): Promise<PersonaProfile[]> {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = getPersonas()
    .then((list) => {
      _cache = list;
      _inflight = null;
      _subscribers.forEach((fn) => fn());
      return list;
    })
    .catch((err) => {
      _inflight = null;
      throw err;
    });
  return _inflight;
}

/** Invalidate the shared persona cache (call after create/edit/delete). */
export function invalidatePersonaCache(): void {
  _cache = null;
  _inflight = null;
}

export interface UsePersonasResult {
  personas: PersonaProfile[];
  byId: Record<string, PersonaProfile>;
  loading: boolean;
  reload: () => Promise<void>;
}

export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<PersonaProfile[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);

  const sync = useCallback(() => {
    setPersonas(_cache ?? []);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await load(true);
      setPersonas(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    _subscribers.add(sync);
    if (_cache === null) {
      load()
        .then((list) => setPersonas(list))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    return () => {
      _subscribers.delete(sync);
    };
  }, [sync]);

  const byId: Record<string, PersonaProfile> = {};
  for (const p of personas) byId[p.id] = p;

  return { personas, byId, loading, reload };
}
