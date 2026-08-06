class ArcadeSound {
  private context: AudioContext | null = null;
  private muted = localStorage.getItem("multipong-muted") === "true";

  isMuted(): boolean {
    return this.muted;
  }

  toggle(): boolean {
    this.muted = !this.muted;
    localStorage.setItem("multipong-muted", String(this.muted));
    if (!this.muted) this.unlock();
    return this.muted;
  }

  unlock(): void {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }

  hit(): void {
    this.tone(160, 0.045, "square", 0.025);
  }

  point(): void {
    this.tone(360, 0.16, "sine", 0.045, 140);
  }

  serve(): void {
    this.tone(520, 0.08, "triangle", 0.025, 660);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, endFrequency?: number): void {
    if (this.muted) return;
    this.unlock();
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, context.currentTime + duration);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}

export const arcadeSound = new ArcadeSound();
