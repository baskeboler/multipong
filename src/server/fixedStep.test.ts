import { describe, expect, it } from "vitest";
import { fixedStepBatch } from "./fixedStep.js";

describe("fixed-step scheduler", () => {
  it("carries partial elapsed time into the next callback", () => {
    expect(fixedStepBatch(4, 8, 10, 5)).toEqual({
      steps: 1,
      remainingMs: 2,
    });
  });

  it("limits catch-up work and drops time beyond the cap", () => {
    expect(fixedStepBatch(8, 200, 10, 5)).toEqual({
      steps: 5,
      remainingMs: 0,
    });
  });

  it("ignores a negative elapsed sample from the clock", () => {
    expect(fixedStepBatch(6, -2, 10, 5)).toEqual({
      steps: 0,
      remainingMs: 6,
    });
  });
});
