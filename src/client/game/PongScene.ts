import Phaser from "phaser";
import { COURT, type MatchSnapshot } from "../../shared/protocol";
import { arcadeSound } from "../audio/arcadeSound";
import { gameBridge } from "../network/gameBridge";

export class PongScene extends Phaser.Scene {
  private leftPaddle!: Phaser.GameObjects.Rectangle;
  private rightPaddle!: Phaser.GameObjects.Rectangle;
  private leftGlow!: Phaser.GameObjects.Rectangle;
  private rightGlow!: Phaser.GameObjects.Rectangle;
  private ball!: Phaser.GameObjects.Arc;
  private ballGlow!: Phaser.GameObjects.Arc;
  private previous: MatchSnapshot | null = null;
  private reducedMotion = false;

  constructor() {
    super("pong");
  }

  create(): void {
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.cameras.main.setBackgroundColor("#050714");
    this.drawCourt();

    [this.leftPaddle, this.leftGlow] = this.neonPaddle(
      COURT.paddleInset,
      0,
      0x5df2ff,
    );
    [this.rightPaddle, this.rightGlow] = this.neonPaddle(
      COURT.width - COURT.paddleInset,
      0,
      0xff4fd8,
    );
    this.ballGlow = this.add
      .circle(0, 0, COURT.ballRadius * 2.5, 0xcffcff, 0.13)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.ball = this.add
      .circle(0, 0, COURT.ballRadius, 0xffffff, 1)
      .setStrokeStyle(2, 0x8df7ff, 1);
  }

  update(): void {
    const state = gameBridge.current();
    if (!state) {
      this.leftPaddle.setVisible(false);
      this.rightPaddle.setVisible(false);
      this.leftGlow.setVisible(false);
      this.rightGlow.setVisible(false);
      this.ball.setVisible(false);
      this.ballGlow.setVisible(false);
      return;
    }
    this.leftPaddle
      .setVisible(true)
      .setPosition(COURT.paddleInset, state.left.y)
      .setAlpha(state.left.connected ? 1 : 0.35);
    this.rightPaddle
      .setVisible(true)
      .setPosition(COURT.width - COURT.paddleInset, state.right.y)
      .setAlpha(state.right.connected ? 1 : 0.35);
    this.leftGlow
      .setVisible(true)
      .setPosition(COURT.paddleInset, state.left.y)
      .setAlpha(state.left.connected ? 0.08 : 0.02);
    this.rightGlow
      .setVisible(true)
      .setPosition(COURT.width - COURT.paddleInset, state.right.y)
      .setAlpha(state.right.connected ? 0.08 : 0.02);
    this.ball.setVisible(true).setPosition(state.ball.x, state.ball.y);
    this.ballGlow.setVisible(true).setPosition(state.ball.x, state.ball.y);
    this.playFeedback(state);
    this.previous = state;
  }

  private drawCourt(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0x29406b, 0.8);
    graphics.strokeRoundedRect(8, 8, COURT.width - 16, COURT.height - 16, 10);
    graphics.lineStyle(2, 0x5df2ff, 0.2);
    graphics.strokeCircle(COURT.width / 2, COURT.height / 2, 82);
    for (let y = 26; y < COURT.height - 20; y += 34) {
      graphics.fillStyle(0xb9f7ff, 0.28);
      graphics.fillRoundedRect(COURT.width / 2 - 2, y, 4, 18, 2);
    }
    for (let x = 30; x < COURT.width; x += 80) {
      graphics.lineStyle(1, 0x25355d, 0.2);
      graphics.lineBetween(x, 12, x, COURT.height - 12);
    }
  }

  private neonPaddle(
    x: number,
    y: number,
    color: number,
  ): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Rectangle] {
    const glow = this.add
      .rectangle(
        x,
        y,
        COURT.paddleWidth + 14,
        COURT.paddleHeight + 14,
        color,
        0.08,
      )
      .setBlendMode(Phaser.BlendModes.ADD);
    const paddle = this.add
      .rectangle(x, y, COURT.paddleWidth, COURT.paddleHeight, color, 1)
      .setStrokeStyle(3, 0xffffff, 0.65);
    return [paddle, glow];
  }

  private playFeedback(state: MatchSnapshot): void {
    if (!this.previous) return;
    if (
      state.score.left !== this.previous.score.left ||
      state.score.right !== this.previous.score.right
    ) {
      arcadeSound.point();
      if (!this.reducedMotion)
        this.cameras.main.flash(110, 93, 242, 255, false, undefined, this);
    } else if (
      Math.sign(state.ball.velocityX) !==
        Math.sign(this.previous.ball.velocityX) &&
      state.phase === "playing"
    ) {
      arcadeSound.hit();
      if (!this.reducedMotion) this.cameras.main.shake(45, 0.0015);
    } else if (state.phase === "playing" && this.previous.phase !== "playing") {
      arcadeSound.serve();
    }
  }
}
