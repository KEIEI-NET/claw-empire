import { useCallback, useEffect, useState } from "react";
import { getPersonas } from "../../api";
import type { PersonaProfile } from "../../types";

// Module-level cache so the catalog (admin-curated, rarely changing) is fetched
// once and shared across AgentCard badges, selectors, and the library.
let _cache: PersonaProfile[] | null = null;
let _inflight: Promise<PersonaProfile[]> | null = null;
let _generation = 0; // bumped on forced reload so a stale in-flight result is discarded
const _subscribers = new Set<() => void>();

async function load(force = false): Promise<PersonaProfile[]> {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  const generation = force ? ++_generation : _generation;
  _inflight = getPersonas()
    .then((list) => {
      if (generation !== _generation) return list; // superseded by a newer reload — discard
      _cache = list;
      _inflight = null;
      _subscribers.forEach((fn) => fn());
      return list;
    })
    .catch((err) => {
      if (generation === _generation) _inflight = null;
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
  error: Error | null;
  reload: () => Promise<void>;
}

export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<PersonaProfile[]>(_cache ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState<Error | null>(null);

  const sync = useCallback(() => {
    setPersonas(_cache ?? []);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await load(true);
      setPersonas(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load personas"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    _subscribers.add(sync);
    if (_cache === null) {
      load()
        .then((list) => setPersonas(list))
        .catch((err) => setError(err instanceof Error ? err : new Error("Failed to load personas")))
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

  return { personas, byId, loading, error, reload };
}
