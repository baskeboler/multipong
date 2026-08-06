import { COURT, type Direction, type MatchSnapshot, type Side } from "../../shared/protocol";

interface BufferedSnapshot {
  state: MatchSnapshot;
  receivedAt: number;
}

class GameBridge {
  private snapshots: BufferedSnapshot[] = [];
  private side: Side | null = null;
  private direction: Direction = 0;

  setSide(side: Side | null): void {
    this.side = side;
  }

  setDirection(direction: Direction): void {
    this.direction = direction;
  }

  push(snapshot: MatchSnapshot): void {
    this.snapshots.push({ state: snapshot, receivedAt: performance.now() });
    this.snapshots = this.snapshots.slice(-8);
  }

  reset(): void {
    this.snapshots = [];
    this.side = null;
    this.direction = 0;
  }

  current(): MatchSnapshot | null {
    if (this.snapshots.length === 0) return null;
    if (this.snapshots.length === 1) return this.withPrediction(this.snapshots[0]);

    const target = performance.now() - 100;
    let before = this.snapshots[0];
    let after = this.snapshots[this.snapshots.length - 1];
    for (let index = 1; index < this.snapshots.length; index += 1) {
      if (this.snapshots[index].receivedAt >= target) {
        before = this.snapshots[index - 1];
        after = this.snapshots[index];
        break;
      }
    }
    const span = Math.max(1, after.receivedAt - before.receivedAt);
    const progress = Math.max(0, Math.min(1, (target - before.receivedAt) / span));
    const state: MatchSnapshot = {
      ...after.state,
      ball: {
        x: lerp(before.state.ball.x, after.state.ball.x, progress),
        y: lerp(before.state.ball.y, after.state.ball.y, progress),
        velocityX: after.state.ball.velocityX,
        velocityY: after.state.ball.velocityY,
      },
      left: {
        ...after.state.left,
        y: lerp(before.state.left.y, after.state.left.y, progress),
      },
      right: {
        ...after.state.right,
        y: lerp(before.state.right.y, after.state.right.y, progress),
      },
    };
    return this.withPrediction({ state, receivedAt: after.receivedAt });
  }

  private withPrediction(buffered: BufferedSnapshot): MatchSnapshot {
    if (!this.side || buffered.state.phase !== "playing") return buffered.state;
    const elapsed = Math.min(0.1, (performance.now() - buffered.receivedAt) / 1000);
    const player = buffered.state[this.side];
    const half = COURT.paddleHeight / 2;
    const predictedY = Math.max(
      half,
      Math.min(COURT.height - half, player.y + this.direction * COURT.paddleSpeed * elapsed),
    );
    return { ...buffered.state, [this.side]: { ...player, y: predictedY } };
  }
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

export const gameBridge = new GameBridge();
