/**
 * Pure geometry for the CEO-office meeting table. Generates the table rect, seat
 * hold-positions (where leader sprites settle), and chair draw-positions for up
 * to `maxSeats` participants — laid out as two rows (above/below the table) with
 * a column count that scales to the seat cap and stays within the office width.
 *
 * Kept Pixi-free so it can be unit-tested without a renderer.
 *
 * INVARIANT: MEETING_MAX_SEATS_UI must be >= the backend seat ceiling
 * (server .../meetings/meeting-config.ts: MEETING_MAX_SEATS_CEILING, also 12).
 * As long as that holds, every seat_index the backend can broadcast maps to a
 * distinct generated seat. If the backend ceiling is ever raised, raise this to
 * match — otherwise seat indices wrap (visual seat collision, not a crash).
 */
export const MEETING_MAX_SEATS_UI = 12;

const SEAT_INSET = 40; // distance from table edge to the outer seat centers
const DESIRED_COL_SPACING = 70; // preferred horizontal gap between seat columns
const MIN_TABLE_W = 220; // never shrink below the original table width
const OFFICE_MARGIN = 16; // keep the table clear of the office walls

export interface Point {
  x: number;
  y: number;
}

export interface MeetingSeatLayout {
  table: { x: number; y: number; w: number; h: number };
  seats: Point[]; // sprite hold positions, length === effective seat count
  chairs: Point[]; // chair draw positions, 1:1 with seats
}

export interface MeetingSeatOptions {
  officeW: number;
  tableY: number;
  tableH: number;
  maxSeats?: number;
}

/**
 * Lay out up to `maxSeats` seats. Seats fill the top row left-to-right, then the
 * bottom row, matching the original 6-seat ordering (0..n top, n.. bottom).
 */
export function computeMeetingSeats({
  officeW,
  tableY,
  tableH,
  maxSeats = MEETING_MAX_SEATS_UI,
}: MeetingSeatOptions): MeetingSeatLayout {
  const seatCount = Math.max(1, Math.floor(maxSeats));
  const cols = Math.ceil(seatCount / 2);

  const maxTableW = Math.max(MIN_TABLE_W, officeW - 2 * OFFICE_MARGIN);
  // Width that seats `cols` columns at the preferred spacing with symmetric
  // insets. For cols === 3 this resolves to the original 220px table exactly.
  const desiredW = Math.max(MIN_TABLE_W, 2 * SEAT_INSET + (cols - 1) * DESIRED_COL_SPACING);
  const tableW = Math.min(maxTableW, desiredW);
  const tableX = Math.floor((officeW - tableW) / 2);

  const colSpacing = cols > 1 ? (tableW - 2 * SEAT_INSET) / (cols - 1) : 0;
  const colX = (col: number): number =>
    cols > 1 ? tableX + SEAT_INSET + col * colSpacing : tableX + tableW / 2;

  const topSeatY = tableY + 2;
  const bottomSeatY = tableY + tableH + 20;
  const topChairY = tableY - 4;
  const bottomChairY = tableY + tableH + 10;

  const seats: Point[] = [];
  const chairs: Point[] = [];
  for (let i = 0; i < seatCount; i++) {
    const col = i % cols;
    const isTopRow = i < cols;
    const x = colX(col);
    seats.push({ x, y: isTopRow ? topSeatY : bottomSeatY });
    chairs.push({ x, y: isTopRow ? topChairY : bottomChairY });
  }

  return { table: { x: tableX, y: tableY, w: tableW, h: tableH }, seats, chairs };
}
