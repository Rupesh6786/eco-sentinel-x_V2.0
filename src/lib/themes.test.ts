import { describe, expect, it } from "vitest";
import { DASHBOARD_THEMES, randomThemeId } from "./themes";

describe("dashboard theme assignment", () => {
  it("provides exactly ten selectable themes", () => {
    expect(DASHBOARD_THEMES).toHaveLength(10);
  });

  it("assigns the first theme at the lower random bound", () => {
    expect(randomThemeId(() => 0)).toBe(1);
  });

  it("assigns the tenth theme at the upper random bound", () => {
    expect(randomThemeId(() => 0.999999)).toBe(10);
  });
});