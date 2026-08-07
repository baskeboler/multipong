import { describe, expect, it } from "vitest";
import {
  COURT,
  type Direction,
  type MatchPhase,
  type MatchSnapshot,
} from "../../shared/protocol";
import { GameBridge } from "./gameBridge";

interface SnapshotOptions {
  ballX?: number;
  leftY?: number;
  leftDirection?: Direction;
  leftAcknowledged?: number;
  phase?: MatchPhase;
  scoreLeft?: number;
}

describe("GameBridge", () => {
  it("uses the simulation timeline and caps extrapolation after packet jitter", () => {
    let now = 0;
    const bridge = new GameBridge(() => now);
    bridge.push(makeSnapshot(0, { ballX: 100 }));
    now = 45;
    bridge.push(makeSnapshot(2, { ballX: 102 }));
    now = 85;
    bridge.push(makeSnapshot(4, { ballX: 104 }));

    now = 100;
    expect(bridge.current()!.ball.x).toBeGreaterThan(101);
    expect(bridge.current()!.ball.x).toBeLessThan(103);

    now = 300;
    expect(bridge.current()!.ball.x).toBeCloseTo(107, 5);
  });

  it("ignores old ticks and resets cleanly for another match", () => {
    let now = 0;
    const bridge = new GameBridge(() => now);
    bridge.push(makeSnapshot(0, { ballX: 100 }));
    now = 40;
    bridge.push(makeSnapshot(2, { ballX: 102 }));
    bridge.push(makeSnapshot(1, { ballX: 900 }));
    expect(bridge.current()!.ball.x).not.toBe(900);

    bridge.reset();
    bridge.push(makeSnapshot(0, { ballX: 400 }, "next-match"));
    expect(bridge.current()!.ball.x).toBe(400);
  });

  it("predicts local input immediately and eases an acknowledged correction", () => {
    let now = 0;
    const bridge = new GameBridge(() => now);
    bridge.setSide("left");
    bridge.push(makeSnapshot(0, { leftY: 270 }));
    expect(bridge.current()!.left.y).toBe(270);

    now = 16;
    bridge.recordInput(1, 1);
    now = 32;
    const predicted = bridge.current()!.left.y;
    expect(predicted).toBeCloseTo(270 + COURT.paddleSpeed * 0.016, 5);

    now = 50;
    bridge.push(
      makeSnapshot(3, {
        leftY: 274,
        leftDirection: 1,
        leftAcknowledged: 1,
      }),
    );
    const reconciled = bridge.current()!.left.y;
    expect(reconciled).toBeGreaterThan(predicted);
    expect(reconciled).toBeLessThan(270 + COURT.paddleSpeed * 0.05);
  });

  it("does not interpolate across a score transition", () => {
    let now = 0;
    const bridge = new GameBridge(() => now);
    bridge.push(makeSnapshot(0, { scoreLeft: 0 }));
    now = 34;
    bridge.push(makeSnapshot(2, { scoreLeft: 1 }));

    now = 80;
    expect(bridge.current()!.score.left).toBe(0);
    now = 110;
    expect(bridge.current()!.score.left).toBe(1);
  });
});

function makeSnapshot(
  tick: number,
  options: SnapshotOptions = {},
  matchId = "match",
): MatchSnapshot {
  return {
    matchId,
    tick,
    serverTime: tick * (1000 / COURT.tickRate),
    phase: options.phase ?? "playing",
    phaseEndsAt: null,
    left: {
      y: options.leftY ?? 270,
      direction: options.leftDirection ?? 0,
      connected: true,
      lastProcessedInput: options.leftAcknowledged ?? 0,
    },
    right: {
      y: 270,
      direction: 0,
      connected: true,
      lastProcessedInput: 0,
    },
    ball: {
      x: options.ballX ?? 100 + tick,
      y: 270,
      velocityX: 60,
      velocityY: 0,
    },
    score: { left: options.scoreLeft ?? 0, right: 0 },
  };
}
