import { describe, expect, it } from "vitest";
import { MEETING_MAX_SEATS_UI, computeMeetingSeats } from "./meeting-seats";

// The original hand-placed scene used a 220px table at mtY=48/mtH=28 with seats
// at x = mtX+40 / +110 / +180 and y = mtY+2 (top) / mtY+mtH+20 (bottom).
describe("computeMeetingSeats", () => {
  it("reproduces the original 6-seat layout byte-for-byte (officeW=360)", () => {
    const layout = computeMeetingSeats({ officeW: 360, tableY: 48, tableH: 28, maxSeats: 6 });
    const mtX = Math.floor((360 - 220) / 2); // 70
    expect(layout.table).toEqual({ x: mtX, y: 48, w: 220, h: 28 });
    expect(layout.seats).toEqual([
      { x: mtX + 40, y: 50 },
      { x: mtX + 110, y: 50 },
      { x: mtX + 180, y: 50 },
      { x: mtX + 40, y: 96 },
      { x: mtX + 110, y: 96 },
      { x: mtX + 180, y: 96 },
    ]);
    expect(layout.chairs).toEqual([
      { x: mtX + 40, y: 44 },
      { x: mtX + 110, y: 44 },
      { x: mtX + 180, y: 44 },
      { x: mtX + 40, y: 86 },
      { x: mtX + 110, y: 86 },
      { x: mtX + 180, y: 86 },
    ]);
  });

  it("defaults to MEETING_MAX_SEATS_UI seats", () => {
    const layout = computeMeetingSeats({ officeW: 480, tableY: 48, tableH: 28 });
    expect(layout.seats).toHaveLength(MEETING_MAX_SEATS_UI);
    expect(layout.chairs).toHaveLength(MEETING_MAX_SEATS_UI);
  });

  it("splits seats into two rows (top row filled first)", () => {
    const layout = computeMeetingSeats({ officeW: 480, tableY: 48, tableH: 28, maxSeats: 8 });
    const topY = 48 + 2;
    const bottomY = 48 + 28 + 20;
    const topRow = layout.seats.filter((s) => s.y === topY);
    const bottomRow = layout.seats.filter((s) => s.y === bottomY);
    expect(topRow).toHaveLength(4); // ceil(8/2) columns on the top row
    expect(bottomRow).toHaveLength(4);
  });

  it("never overflows the office width even at the max seat cap", () => {
    const officeW = 360;
    const layout = computeMeetingSeats({ officeW, tableY: 48, tableH: 28, maxSeats: 12 });
    expect(layout.table.x).toBeGreaterThanOrEqual(0);
    expect(layout.table.x + layout.table.w).toBeLessThanOrEqual(officeW);
    for (const seat of layout.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(layout.table.x);
      expect(seat.x).toBeLessThanOrEqual(layout.table.x + layout.table.w);
    }
  });

  it("keeps the table centered in the office", () => {
    const officeW = 500;
    const layout = computeMeetingSeats({ officeW, tableY: 48, tableH: 28, maxSeats: 8 });
    const leftGap = layout.table.x;
    const rightGap = officeW - (layout.table.x + layout.table.w);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1); // floor rounding
  });

  it("widens the table as the column count grows", () => {
    const six = computeMeetingSeats({ officeW: 600, tableY: 48, tableH: 28, maxSeats: 6 });
    const twelve = computeMeetingSeats({ officeW: 600, tableY: 48, tableH: 28, maxSeats: 12 });
    expect(twelve.table.w).toBeGreaterThan(six.table.w);
  });
});
