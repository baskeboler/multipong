import {
  COURT,
  type BallSnapshot,
  type Direction,
  type MatchSnapshot,
  type PlayerSnapshot,
  type Side,
} from "../../shared/protocol";

interface BufferedSnapshot {
  state: MatchSnapshot;
  receivedAt: number;
}

interface PendingInput {
  direction: Direction;
  sequence: number;
  sentAt: number;
}

type MonotonicClock = () => number;

const TICK_MS = 1000 / COURT.tickRate;
const SNAPSHOT_MS = 1000 / COURT.snapshotRate;
const MIN_INTERPOLATION_MS = SNAPSHOT_MS * 2;
const MAX_INTERPOLATION_MS = 150;
const MAX_EXTRAPOLATION_MS = 50;
const MAX_FRAME_MS = 50;
const RECONCILIATION_MS = 100;

export class GameBridge {
  private snapshots: BufferedSnapshot[] = [];
  private side: Side | null = null;
  private direction: Direction = 0;
  private pendingInputs: PendingInput[] = [];
  private timelineOrigin: number | null = null;
  private arrivalJitterMs = 0;
  private localY: number | null = null;
  private localUpdatedAt: number | null = null;

  constructor(private readonly now: MonotonicClock = () => performance.now()) {}

  setSide(side: Side | null): void {
    this.side = side;
  }

  setDirection(direction: Direction): void {
    this.direction = direction;
  }

  recordInput(direction: Direction, sequence: number): void {
    const sentAt = this.now();
    if (this.localY !== null && this.localUpdatedAt !== null) {
      const elapsedMs = clamp(sentAt - this.localUpdatedAt, 0, MAX_FRAME_MS);
      this.localY = movePaddle(
        this.localY,
        this.direction,
        elapsedMs / 1000,
      );
      this.localUpdatedAt = sentAt;
    }
    this.direction = direction;
    this.pendingInputs.push({ direction, sequence, sentAt });
    this.pendingInputs = this.pendingInputs.slice(-32);
  }

  push(snapshot: MatchSnapshot): void {
    const receivedAt = this.now();
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest) {
      if (latest.state.matchId !== snapshot.matchId) this.resetTimeline();
      else if (snapshot.tick <= latest.state.tick) return;
    }

    const previous = this.snapshots[this.snapshots.length - 1];
    if (previous) {
      const expectedMs = (snapshot.tick - previous.state.tick) * TICK_MS;
      const actualMs = receivedAt - previous.receivedAt;
      const sample = Math.abs(actualMs - expectedMs);
      this.arrivalJitterMs = lerp(this.arrivalJitterMs, sample, 0.1);
    }

    const originSample = receivedAt - snapshot.tick * TICK_MS;
    if (this.timelineOrigin === null) this.timelineOrigin = originSample;
    else if (originSample < this.timelineOrigin) {
      this.timelineOrigin = lerp(this.timelineOrigin, originSample, 0.1);
    }

    this.snapshots.push({ state: snapshot, receivedAt });
    this.snapshots = this.snapshots.slice(-16);
    if (this.side) {
      const acknowledged = snapshot[this.side].lastProcessedInput;
      this.pendingInputs = this.pendingInputs.filter(
        (input) => input.sequence > acknowledged,
      );
    }
  }

  reset(): void {
    this.resetTimeline();
    this.side = null;
    this.direction = 0;
    this.pendingInputs = [];
  }

  current(): MatchSnapshot | null {
    if (this.snapshots.length === 0 || this.timelineOrigin === null) return null;
    const now = this.now();
    const interpolationMs = clamp(
      MIN_INTERPOLATION_MS + this.arrivalJitterMs * 2,
      MIN_INTERPOLATION_MS,
      MAX_INTERPOLATION_MS,
    );
    const targetTick =
      (now - this.timelineOrigin - interpolationMs) / TICK_MS;
    const state = this.stateAt(targetTick);
    return this.withLocalPrediction(state, now);
  }

  private stateAt(targetTick: number): MatchSnapshot {
    const first = this.snapshots[0];
    const latest = this.snapshots[this.snapshots.length - 1];
    if (targetTick <= first.state.tick) return first.state;

    for (let index = 1; index < this.snapshots.length; index += 1) {
      const before = this.snapshots[index - 1].state;
      const after = this.snapshots[index].state;
      if (after.tick < targetTick) continue;
      if (hasDiscontinuity(before, after)) return before;
      const progress = clamp(
        (targetTick - before.tick) / Math.max(1, after.tick - before.tick),
        0,
        1,
      );
      return interpolateSnapshot(before, after, progress);
    }

    const elapsedMs = Math.min(
      Math.max(0, (targetTick - latest.state.tick) * TICK_MS),
      MAX_EXTRAPOLATION_MS,
    );
    return extrapolateSnapshot(latest.state, elapsedMs / 1000);
  }

  private withLocalPrediction(
    state: MatchSnapshot,
    now: number,
  ): MatchSnapshot {
    if (!this.side) return state;
    const targetY = this.predictedLocalY(now);
    if (targetY === null) return state;

    if (
      this.localY === null ||
      this.localUpdatedAt === null ||
      state.phase === "paused" ||
      state.phase === "finished"
    ) {
      this.localY = targetY;
      this.localUpdatedAt = now;
    } else {
      const elapsedMs = clamp(now - this.localUpdatedAt, 0, MAX_FRAME_MS);
      this.localY = clampPaddle(
        this.localY +
          this.direction * COURT.paddleSpeed * (elapsedMs / 1000),
      );
      const error = targetY - this.localY;
      if (Math.abs(error) > COURT.paddleHeight / 2) this.localY = targetY;
      else {
        this.localY += error * Math.min(1, elapsedMs / RECONCILIATION_MS);
      }
      this.localUpdatedAt = now;
    }

    return {
      ...state,
      [this.side]: { ...state[this.side], y: this.localY },
    };
  }

  private predictedLocalY(now: number): number | null {
    if (!this.side || this.timelineOrigin === null) return null;
    const latest = this.snapshots[this.snapshots.length - 1]?.state;
    if (!latest) return null;
    const player = latest[this.side];
    let y = player.y;
    let direction = player.direction;
    let cursor = this.timelineOrigin + latest.tick * TICK_MS;

    for (const input of this.pendingInputs) {
      const inputAt = Math.max(cursor, input.sentAt);
      y = movePaddle(y, direction, (inputAt - cursor) / 1000);
      cursor = inputAt;
      direction = input.direction;
    }

    return movePaddle(y, direction, Math.max(0, now - cursor) / 1000);
  }

  private resetTimeline(): void {
    this.snapshots = [];
    this.pendingInputs = [];
    this.direction = 0;
    this.timelineOrigin = null;
    this.arrivalJitterMs = 0;
    this.localY = null;
    this.localUpdatedAt = null;
  }
}

function hasDiscontinuity(
  before: MatchSnapshot,
  after: MatchSnapshot,
): boolean {
  return (
    before.phase !== after.phase ||
    before.score.left !== after.score.left ||
    before.score.right !== after.score.right
  );
}

function interpolateSnapshot(
  before: MatchSnapshot,
  after: MatchSnapshot,
  progress: number,
): MatchSnapshot {
  return {
    ...after,
    ball: {
      x: lerp(before.ball.x, after.ball.x, progress),
      y: lerp(before.ball.y, after.ball.y, progress),
      velocityX: after.ball.velocityX,
      velocityY: after.ball.velocityY,
    },
    left: interpolatePlayer(before.left, after.left, progress),
    right: interpolatePlayer(before.right, after.right, progress),
  };
}

function interpolatePlayer(
  before: PlayerSnapshot,
  after: PlayerSnapshot,
  progress: number,
): PlayerSnapshot {
  return {
    ...after,
    y: lerp(before.y, after.y, progress),
  };
}

function extrapolateSnapshot(
  state: MatchSnapshot,
  elapsedSeconds: number,
): MatchSnapshot {
  if (
    state.phase === "paused" ||
    state.phase === "finished" ||
    elapsedSeconds <= 0
  ) {
    return state;
  }
  return {
    ...state,
    ball:
      state.phase === "playing"
        ? extrapolateBall(state.ball, elapsedSeconds)
        : state.ball,
    left: {
      ...state.left,
      y: movePaddle(state.left.y, state.left.direction, elapsedSeconds),
    },
    right: {
      ...state.right,
      y: movePaddle(state.right.y, state.right.direction, elapsedSeconds),
    },
  };
}

function extrapolateBall(
  ball: BallSnapshot,
  elapsedSeconds: number,
): BallSnapshot {
  let y = ball.y + ball.velocityY * elapsedSeconds;
  let velocityY = ball.velocityY;
  if (y < COURT.ballRadius) {
    y = COURT.ballRadius + (COURT.ballRadius - y);
    velocityY *= -1;
  } else if (y > COURT.height - COURT.ballRadius) {
    const bottom = COURT.height - COURT.ballRadius;
    y = bottom - (y - bottom);
    velocityY *= -1;
  }
  return {
    x: ball.x + ball.velocityX * elapsedSeconds,
    y,
    velocityX: ball.velocityX,
    velocityY,
  };
}

function movePaddle(
  y: number,
  direction: Direction,
  elapsedSeconds: number,
): number {
  return clampPaddle(y + direction * COURT.paddleSpeed * elapsedSeconds);
}

function clampPaddle(y: number): number {
  const half = COURT.paddleHeight / 2;
  return clamp(y, half, COURT.height - half);
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export const gameBridge = new GameBridge();
