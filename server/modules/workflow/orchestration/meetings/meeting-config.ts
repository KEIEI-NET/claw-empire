import { readNonNegativeIntEnv } from "../../../../db/runtime.ts";

/**
 * Hard ceiling for distinct meeting seats. The CEO-office scene renders a finite
 * grid of chairs, so seat indices are capped here. Leaders beyond the cap still
 * join the discussion and the minutes (the speaking loops are uncapped); they
 * simply share/wrap a visualized seat instead of getting their own.
 *
 * Keep MEETING_MAX_SEATS_CEILING in sync with the UI seat generator
 * (src/components/office-view/meeting-seats.ts) so the backend never assigns a
 * seat index the scene cannot render distinctly.
 */
export const MEETING_MAX_SEATS_CEILING = 12;
const MEETING_MAX_SEATS_FLOOR = 2;
const MEETING_MAX_SEATS_DEFAULT = 8;

function clampSeatCap(value: number): number {
  if (value < MEETING_MAX_SEATS_FLOOR) return MEETING_MAX_SEATS_FLOOR;
  if (value > MEETING_MAX_SEATS_CEILING) return MEETING_MAX_SEATS_CEILING;
  return value;
}

/**
 * Max number of leaders given a distinct seat in the CEO office. Configurable via
 * the MEETING_MAX_SEATS env var, clamped to [2, 12].
 */
export const MEETING_MAX_SEATS = clampSeatCap(
  readNonNegativeIntEnv("MEETING_MAX_SEATS", MEETING_MAX_SEATS_DEFAULT),
);
