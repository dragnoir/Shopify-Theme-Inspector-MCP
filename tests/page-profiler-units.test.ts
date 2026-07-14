import { describe, expect, it } from "vitest";
import {
  parseSpeedscopeData,
  timeUnitMultiplierToMilliseconds,
} from "../src/profiler/page-profiler.js";

describe("speedscope time normalization", () => {
  it.each([
    ["nanoseconds", 0.000001],
    ["microseconds", 0.001],
    ["milliseconds", 1],
    ["seconds", 1000],
  ])("converts %s to milliseconds", (unit, multiplier) => {
    expect(timeUnitMultiplierToMilliseconds(unit)).toBe(multiplier);
  });

  it("defaults unknown units to Shopify's historical microseconds", () => {
    expect(timeUnitMultiplierToMilliseconds("unknown")).toBe(0.001);
  });

  it("normalizes nanosecond evented profiles before analysis", () => {
    const result = parseSpeedscopeData({
      $schema: "https://www.speedscope.app/file-format-schema.json",
      shared: {
        frames: [{ name: "layout/theme", file: "layout/theme", line: 1 }],
      },
      profiles: [{
        type: "evented",
        name: "Liquid",
        unit: "nanoseconds",
        startValue: 0,
        endValue: 250_000_000,
        events: [
          { type: "O", at: 0, frame: 0 },
          { type: "C", at: 250_000_000, frame: 0 },
        ],
      }],
    });

    expect(result.totalTime).toBe(250);
    expect(result.tree.children[0]?.totalTime).toBe(250);
  });
});
