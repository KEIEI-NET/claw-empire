import { afterEach, describe, expect, it, vi } from "vitest";

async function loadCapWithEnv(value: string | undefined): Promise<number> {
  vi.resetModules();
  // An empty string is treated as "unset" by readNonNegativeIntEnv (`!raw`),
  // so it cleanly models the undefined case without mutating process.env directly.
  vi.stubEnv("MEETING_MAX_SEATS", value ?? "");
  const mod = await import("./meeting-config.ts");
  return mod.MEETING_MAX_SEATS;
}

describe("MEETING_MAX_SEATS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to 8 when the env var is unset", async () => {
    expect(await loadCapWithEnv(undefined)).toBe(8);
  });

  it("reads a valid override from the env var", async () => {
    expect(await loadCapWithEnv("10")).toBe(10);
  });

  it("clamps values above the ceiling (12)", async () => {
    expect(await loadCapWithEnv("999")).toBe(12);
  });

  it("clamps values below the floor (2)", async () => {
    expect(await loadCapWithEnv("1")).toBe(2);
  });

  it("falls back to the default for non-numeric input", async () => {
    expect(await loadCapWithEnv("not-a-number")).toBe(8);
  });
});
