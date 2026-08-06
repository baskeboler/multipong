import { describe, expect, it } from "vitest";
import { COURT } from "../shared/protocol.js";
import { applyInput, createSimulation, stepSimulation } from "./simulation.js";

const players = {
  left: { id: "left", nickname: "Laser" },
  right: { id: "right", nickname: "Ghost" },
};

describe("authoritative Pong simulation", () => {
  it("starts after the countdown and serves at the configured speed", () => {
    const state = createSimulation("match", players.left, players.right, 1_000);
    stepSimulation(state, COURT.countdownMs / 1000, 4_000, () => 0.5);
    expect(state.phase).toBe("playing");
    expect(Math.hypot(state.ball.velocityX, state.ball.velocityY)).toBeCloseTo(COURT.initialBallSpeed);
  });

  it("moves paddles without letting them leave the court", () => {
    const state = createSimulation("match", players.left, players.right);
    applyInput(state, "left", -1, 1);
    stepSimulation(state, 10);
    expect(state.left.y).toBe(COURT.paddleHeight / 2);
    applyInput(state, "left", 1, 2);
    stepSimulation(state, 10);
    expect(state.left.y).toBe(COURT.height - COURT.paddleHeight / 2);
  });

  it("ignores stale input sequence numbers", () => {
    const state = createSimulation("match", players.left, players.right);
    applyInput(state, "left", 1, 3);
    applyInput(state, "left", -1, 2);
    expect(state.left.direction).toBe(1);
    expect(state.left.lastProcessedInput).toBe(3);
  });

  it("reflects and accelerates the ball at a paddle", () => {
    const state = createSimulation("match", players.left, players.right);
    state.phase = "playing";
    state.ball = {
      x: COURT.paddleInset + COURT.paddleWidth / 2 + COURT.ballRadius,
      y: state.left.y + 20,
      velocityX: -COURT.initialBallSpeed,
      velocityY: 0,
    };
    stepSimulation(state, 1 / COURT.tickRate);
    expect(state.ball.velocityX).toBeGreaterThan(0);
    expect(Math.hypot(state.ball.velocityX, state.ball.velocityY)).toBeGreaterThan(COURT.initialBallSpeed);
  });

  it("awards a point and serves toward the player who conceded", () => {
    const state = createSimulation("match", players.left, players.right, 1_000);
    state.phase = "playing";
    state.ball.x = -COURT.ballRadius - 1;
    state.ball.velocityX = -100;
    stepSimulation(state, 1 / COURT.tickRate, 2_000);
    expect(state.score.right).toBe(1);
    expect(state.phase).toBe("point");
    expect(state.nextServeDirection).toBe(-1);
  });

  it("finishes immediately when a player reaches seven", () => {
    const state = createSimulation("match", players.left, players.right);
    state.phase = "playing";
    state.score.left = COURT.winningScore - 1;
    state.ball.x = COURT.width + COURT.ballRadius + 1;
    state.ball.velocityX = 100;
    stepSimulation(state, 1 / COURT.tickRate);
    expect(state.score.left).toBe(COURT.winningScore);
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe("left");
  });

  it("caps ball acceleration at the configured maximum", () => {
    const state = createSimulation("match", players.left, players.right);
    state.phase = "playing";
    state.ball = {
      x: COURT.paddleInset + COURT.paddleWidth / 2 + COURT.ballRadius,
      y: state.left.y,
      velocityX: -COURT.maxBallSpeed,
      velocityY: 0,
    };
    stepSimulation(state, 1 / COURT.tickRate);
    expect(Math.hypot(state.ball.velocityX, state.ball.velocityY)).toBeCloseTo(COURT.maxBallSpeed);
  });
});
