import { COURT, type Direction, type MatchPhase, type MatchSnapshot, type Side } from "../shared/protocol.js";

export interface SimulationPlayer {
  id: string;
  nickname: string;
  y: number;
  direction: Direction;
  connected: boolean;
  lastProcessedInput: number;
}

export interface SimulationState {
  matchId: string;
  tick: number;
  phase: MatchPhase;
  phaseRemainingMs: number;
  phaseEndsAt: number | null;
  left: SimulationPlayer;
  right: SimulationPlayer;
  ball: { x: number; y: number; velocityX: number; velocityY: number };
  score: { left: number; right: number };
  nextServeDirection: -1 | 1;
  winner: Side | null;
}

export interface PlayerSeed {
  id: string;
  nickname: string;
}

const centerY = COURT.height / 2;

export function createSimulation(
  matchId: string,
  left: PlayerSeed,
  right: PlayerSeed,
  now = Date.now(),
): SimulationState {
  return {
    matchId,
    tick: 0,
    phase: "countdown",
    phaseRemainingMs: COURT.countdownMs,
    phaseEndsAt: now + COURT.countdownMs,
    left: createPlayer(left),
    right: createPlayer(right),
    ball: { x: COURT.width / 2, y: centerY, velocityX: 0, velocityY: 0 },
    score: { left: 0, right: 0 },
    nextServeDirection: Math.random() < 0.5 ? -1 : 1,
    winner: null,
  };
}

function createPlayer(seed: PlayerSeed): SimulationPlayer {
  return {
    ...seed,
    y: centerY,
    direction: 0,
    connected: true,
    lastProcessedInput: 0,
  };
}

export function applyInput(
  state: SimulationState,
  side: Side,
  direction: Direction,
  sequence: number,
): void {
  const player = state[side];
  if (sequence <= player.lastProcessedInput) return;
  player.direction = direction;
  player.lastProcessedInput = sequence;
}

export function stepSimulation(
  state: SimulationState,
  deltaSeconds: number,
  now = Date.now(),
  random: () => number = Math.random,
): void {
  if (state.phase === "paused" || state.phase === "finished") return;

  state.tick += 1;
  movePaddle(state.left, deltaSeconds);
  movePaddle(state.right, deltaSeconds);

  if (state.phase === "countdown" || state.phase === "point") {
    state.phaseRemainingMs -= deltaSeconds * 1000;
    state.phaseEndsAt = now + Math.max(0, state.phaseRemainingMs);
    if (state.phaseRemainingMs <= 0) serve(state, random);
    return;
  }

  if (state.phase !== "playing") return;

  state.ball.x += state.ball.velocityX * deltaSeconds;
  state.ball.y += state.ball.velocityY * deltaSeconds;

  collideWithTopAndBottom(state);
  collideWithPaddle(state, "left");
  collideWithPaddle(state, "right");

  if (state.ball.x + COURT.ballRadius < 0) scorePoint(state, "right", now);
  if (state.ball.x - COURT.ballRadius > COURT.width) scorePoint(state, "left", now);
}

function movePaddle(player: SimulationPlayer, deltaSeconds: number): void {
  const half = COURT.paddleHeight / 2;
  const next = player.y + player.direction * COURT.paddleSpeed * deltaSeconds;
  player.y = Math.max(half, Math.min(COURT.height - half, next));
}

function collideWithTopAndBottom(state: SimulationState): void {
  if (state.ball.y - COURT.ballRadius <= 0 && state.ball.velocityY < 0) {
    state.ball.y = COURT.ballRadius;
    state.ball.velocityY *= -1;
  } else if (state.ball.y + COURT.ballRadius >= COURT.height && state.ball.velocityY > 0) {
    state.ball.y = COURT.height - COURT.ballRadius;
    state.ball.velocityY *= -1;
  }
}

function collideWithPaddle(state: SimulationState, side: Side): void {
  const paddle = state[side];
  const paddleX = side === "left" ? COURT.paddleInset : COURT.width - COURT.paddleInset;
  const halfWidth = COURT.paddleWidth / 2;
  const halfHeight = COURT.paddleHeight / 2;
  const movingTowardPaddle = side === "left" ? state.ball.velocityX < 0 : state.ball.velocityX > 0;
  if (!movingTowardPaddle) return;

  const withinX = Math.abs(state.ball.x - paddleX) <= halfWidth + COURT.ballRadius;
  const withinY = Math.abs(state.ball.y - paddle.y) <= halfHeight + COURT.ballRadius;
  if (!withinX || !withinY) return;

  const normalizedHit = Math.max(-1, Math.min(1, (state.ball.y - paddle.y) / halfHeight));
  const currentSpeed = Math.hypot(state.ball.velocityX, state.ball.velocityY);
  const speed = Math.min(COURT.maxBallSpeed, currentSpeed * COURT.ballAcceleration);
  const angle = normalizedHit * (Math.PI / 3);
  const direction = side === "left" ? 1 : -1;

  state.ball.x = paddleX + direction * (halfWidth + COURT.ballRadius + 0.1);
  state.ball.velocityX = direction * Math.cos(angle) * speed;
  state.ball.velocityY = Math.sin(angle) * speed + paddle.direction * 24;
}

function scorePoint(state: SimulationState, scorer: Side, now: number): void {
  state.score[scorer] += 1;
  state.ball.x = COURT.width / 2;
  state.ball.y = centerY;
  state.ball.velocityX = 0;
  state.ball.velocityY = 0;

  if (state.score[scorer] >= COURT.winningScore) {
    state.phase = "finished";
    state.phaseEndsAt = null;
    state.winner = scorer;
    return;
  }

  state.phase = "point";
  state.phaseRemainingMs = COURT.pointPauseMs;
  state.phaseEndsAt = now + COURT.pointPauseMs;
  state.nextServeDirection = scorer === "left" ? 1 : -1;
}

function serve(state: SimulationState, random: () => number): void {
  const vertical = (random() * 2 - 1) * 0.52;
  const horizontal = Math.sqrt(1 - vertical * vertical) * state.nextServeDirection;
  state.ball.x = COURT.width / 2;
  state.ball.y = centerY;
  state.ball.velocityX = horizontal * COURT.initialBallSpeed;
  state.ball.velocityY = vertical * COURT.initialBallSpeed;
  state.phase = "playing";
  state.phaseRemainingMs = 0;
  state.phaseEndsAt = null;
}

export function snapshot(state: SimulationState, serverTime = Date.now()): MatchSnapshot {
  return {
    matchId: state.matchId,
    tick: state.tick,
    serverTime,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    left: { ...state.left },
    right: { ...state.right },
    ball: { ...state.ball },
    score: { ...state.score },
  };
}
