export interface FixedStepBatch {
  steps: number;
  remainingMs: number;
}

export function fixedStepBatch(
  accumulatorMs: number,
  elapsedMs: number,
  stepMs: number,
  maximumSteps: number,
): FixedStepBatch {
  const availableMs = Math.min(
    stepMs * maximumSteps,
    accumulatorMs + Math.max(0, elapsedMs),
  );
  const steps = Math.min(
    maximumSteps,
    Math.floor((availableMs + Number.EPSILON) / stepMs),
  );
  return {
    steps,
    remainingMs: Math.max(0, availableMs - steps * stepMs),
  };
}
