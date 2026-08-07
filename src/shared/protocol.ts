import { z } from "zod";

export const COURT = {
  width: 960,
  height: 540,
  paddleWidth: 18,
  paddleHeight: 112,
  paddleInset: 42,
  paddleSpeed: 420,
  ballRadius: 10,
  initialBallSpeed: 320,
  maxBallSpeed: 720,
  ballAcceleration: 1.045,
  winningScore: 7,
  tickRate: 60,
  snapshotRate: 30,
  reconnectGraceMs: 20_000,
  countdownMs: 3_000,
  pointPauseMs: 1_000,
} as const;

export type Side = "left" | "right";
export type MatchPhase = "countdown" | "playing" | "point" | "paused" | "finished";
export type Direction = -1 | 0 | 1;

export interface PlayerSnapshot {
  y: number;
  direction: Direction;
  connected: boolean;
  lastProcessedInput: number;
}

export interface MatchPlayer {
  id: string;
  nickname: string;
}

export interface BallSnapshot {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

export interface MatchSnapshot {
  matchId: string;
  tick: number;
  serverTime: number;
  phase: MatchPhase;
  phaseEndsAt: number | null;
  left: PlayerSnapshot;
  right: PlayerSnapshot;
  ball: BallSnapshot;
  score: { left: number; right: number };
}

export interface SessionInfo {
  playerId: string;
  nickname: string;
  sessionToken: string;
  resumed: boolean;
}

export interface LobbyState {
  mode: "idle" | "queueing" | "private-room";
  roomCode?: string;
  message: string;
}

export interface MatchReady {
  matchId: string;
  side: Side;
  players: Record<Side, MatchPlayer>;
}

export interface MatchEnded {
  matchId: string;
  winner: Side;
  winnerName: string;
  reason: "score" | "forfeit";
  score: { left: number; right: number };
}

export interface RematchState {
  requestedBy: Side[];
  ready: boolean;
}

export interface PausedState {
  disconnectedPlayer: string;
  reconnectDeadline: number;
}

export interface ApiError {
  code: string;
  message: string;
}

export type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export type Ack<T = undefined> = (result: Result<T>) => void;

export const registerSchema = z.object({
  nickname: z.string().trim().min(2).max(16),
});

export const roomCodeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5}$/),
});

export const inputSchema = z.object({
  sequence: z.number().int().nonnegative(),
  direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export interface ClientToServerEvents {
  "session:register": (payload: z.infer<typeof registerSchema>, ack: Ack<SessionInfo>) => void;
  "queue:join": (ack: Ack) => void;
  "queue:leave": (ack: Ack) => void;
  "room:create": (ack: Ack<{ code: string }>) => void;
  "room:join": (payload: z.infer<typeof roomCodeSchema>, ack: Ack) => void;
  "match:input": (payload: z.infer<typeof inputSchema>) => void;
  "match:rematch": (ack: Ack) => void;
  "match:leave": (ack: Ack) => void;
}

export interface ServerToClientEvents {
  "session:ready": (session: SessionInfo) => void;
  "lobby:state": (state: LobbyState) => void;
  "match:ready": (match: MatchReady) => void;
  "match:snapshot": (snapshot: MatchSnapshot) => void;
  "match:paused": (state: PausedState) => void;
  "match:resumed": () => void;
  "match:ended": (result: MatchEnded) => void;
  "match:rematch-state": (state: RematchState) => void;
  "server:error": (error: ApiError) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  playerId?: string;
}
