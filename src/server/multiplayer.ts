import { randomBytes, randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  COURT,
  inputSchema,
  registerSchema,
  roomCodeSchema,
  type Ack,
  type ClientToServerEvents,
  type InterServerEvents,
  type MatchEnded,
  type MatchPhase,
  type ServerToClientEvents,
  type SessionInfo,
  type Side,
  type SocketData,
} from "../shared/protocol.js";
import { applyInput, createSimulation, snapshot, stepSimulation, type SimulationState } from "./simulation.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface Session {
  id: string;
  token: string;
  nickname: string;
  socketId: string | null;
  queueing: boolean;
  roomCode: string | null;
  matchId: string | null;
  side: Side | null;
  inputWindowStarted: number;
  inputCount: number;
}

interface PrivateRoom {
  code: string;
  ownerId: string;
  expires: NodeJS.Timeout;
}

interface Match {
  id: string;
  leftId: string;
  rightId: string;
  simulation: SimulationState;
  loop: NodeJS.Timeout | null;
  disconnected: Set<Side>;
  reconnectTimers: Map<Side, NodeJS.Timeout>;
  phaseBeforePause: MatchPhase | null;
  remainingBeforePause: number;
  rematchRequests: Set<Side>;
  ended: MatchEnded | null;
  cleanupTimer: NodeJS.Timeout | null;
}

interface MultiplayerOptions {
  clientOrigin?: string;
  reconnectGraceMs?: number;
  privateRoomLifetimeMs?: number;
}

const ok = <T>(data: T) => ({ ok: true as const, data });
const failure = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

export class MultiplayerServer {
  readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private readonly sessions = new Map<string, Session>();
  private readonly sessionsByToken = new Map<string, Session>();
  private readonly rooms = new Map<string, PrivateRoom>();
  private readonly matches = new Map<string, Match>();
  private readonly quickQueue: string[] = [];
  private readonly reconnectGraceMs: number;
  private readonly privateRoomLifetimeMs: number;

  constructor(server: HttpServer, options: MultiplayerOptions = {}) {
    this.reconnectGraceMs = options.reconnectGraceMs ?? COURT.reconnectGraceMs;
    this.privateRoomLifetimeMs = options.privateRoomLifetimeMs ?? 5 * 60_000;
    this.io = new Server(server, {
      cors: options.clientOrigin ? { origin: options.clientOrigin } : undefined,
    });
    this.io.on("connection", (socket) => this.onConnection(socket));
  }

  async close(): Promise<void> {
    for (const match of this.matches.values()) {
      this.stopMatchLoop(match);
      if (match.cleanupTimer) clearTimeout(match.cleanupTimer);
    }
    for (const room of this.rooms.values()) clearTimeout(room.expires);
    this.io.disconnectSockets(true);
    this.io.close();
  }

  private onConnection(socket: GameSocket): void {
    const token = typeof socket.handshake.auth.sessionToken === "string"
      ? socket.handshake.auth.sessionToken
      : null;
    if (token) this.resumeSession(socket, token);

    socket.on("session:register", (payload, ack) => this.register(socket, payload, ack));
    socket.on("queue:join", (ack) => this.joinQueue(socket, ack));
    socket.on("queue:leave", (ack) => this.leaveQueue(socket, ack));
    socket.on("room:create", (ack) => this.createRoom(socket, ack));
    socket.on("room:join", (payload, ack) => this.joinRoom(socket, payload, ack));
    socket.on("match:input", (payload) => this.handleInput(socket, payload));
    socket.on("match:rematch", (ack) => this.requestRematch(socket, ack));
    socket.on("match:leave", (ack) => this.leaveMatch(socket, ack));
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  private register(socket: GameSocket, payload: unknown, ack: Ack<SessionInfo>): void {
    const current = this.sessionForSocket(socket);
    if (current) {
      ack(ok(this.sessionInfo(current, false)));
      return;
    }

    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) {
      ack(failure("INVALID_NICKNAME", "Use a nickname between 2 and 16 characters."));
      return;
    }

    const session: Session = {
      id: randomUUID(),
      token: randomBytes(24).toString("base64url"),
      nickname: parsed.data.nickname,
      socketId: socket.id,
      queueing: false,
      roomCode: null,
      matchId: null,
      side: null,
      inputWindowStarted: Date.now(),
      inputCount: 0,
    };
    this.sessions.set(session.id, session);
    this.sessionsByToken.set(session.token, session);
    socket.data.playerId = session.id;
    const info = this.sessionInfo(session, false);
    socket.emit("session:ready", info);
    socket.emit("lobby:state", { mode: "idle", message: "Choose how you want to play." });
    ack(ok(info));
  }

  private resumeSession(socket: GameSocket, token: string): void {
    const session = this.sessionsByToken.get(token);
    if (!session) return;

    if (session.socketId && session.socketId !== socket.id) {
      this.io.sockets.sockets.get(session.socketId)?.disconnect(true);
    }
    session.socketId = socket.id;
    socket.data.playerId = session.id;
    socket.emit("session:ready", this.sessionInfo(session, true));

    if (!session.matchId || !session.side) {
      socket.emit("lobby:state", { mode: "idle", message: "Session restored." });
      return;
    }

    const match = this.matches.get(session.matchId);
    if (!match) {
      this.detachFromMatch(session);
      socket.emit("lobby:state", { mode: "idle", message: "Session restored." });
      return;
    }

    socket.join(match.id);
    match.simulation[session.side].connected = true;
    match.disconnected.delete(session.side);
    const reconnectTimer = match.reconnectTimers.get(session.side);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    match.reconnectTimers.delete(session.side);
    this.emitMatchReady(session, match);
    socket.emit("match:snapshot", snapshot(match.simulation));

    if (match.ended) {
      socket.emit("match:ended", match.ended);
    } else if (match.disconnected.size === 0 && match.simulation.phase === "paused") {
      this.resumeMatch(match);
    }
  }

  private joinQueue(socket: GameSocket, ack: Ack): void {
    const session = this.requireLobbySession(socket, ack);
    if (!session) return;
    this.removeFromLobby(session);

    const opponentId = this.quickQueue.find((id) => {
      const candidate = this.sessions.get(id);
      return candidate
        && candidate.id !== session.id
        && candidate.socketId
        && !candidate.matchId
        && candidate.nickname.toLocaleLowerCase() !== session.nickname.toLocaleLowerCase();
    });

    if (opponentId) {
      this.removeQueueId(opponentId);
      const opponent = this.sessions.get(opponentId)!;
      opponent.queueing = false;
      this.startMatch(opponent, session);
    } else {
      session.queueing = true;
      this.quickQueue.push(session.id);
      socket.emit("lobby:state", { mode: "queueing", message: "Scanning the grid for an opponent…" });
    }
    ack(ok(undefined));
  }

  private leaveQueue(socket: GameSocket, ack: Ack): void {
    const session = this.requireSession(socket, ack);
    if (!session) return;
    this.removeFromLobby(session);
    socket.emit("lobby:state", { mode: "idle", message: "Matchmaking cancelled." });
    ack(ok(undefined));
  }

  private createRoom(socket: GameSocket, ack: Ack<{ code: string }>): void {
    const session = this.requireLobbySession(socket, ack);
    if (!session) return;
    this.removeFromLobby(session);
    const code = this.uniqueRoomCode();
    const expires = setTimeout(() => this.expireRoom(code), this.privateRoomLifetimeMs);
    this.rooms.set(code, { code, ownerId: session.id, expires });
    session.roomCode = code;
    socket.emit("lobby:state", { mode: "private-room", roomCode: code, message: "Share this code with your opponent." });
    ack(ok({ code }));
  }

  private joinRoom(socket: GameSocket, payload: unknown, ack: Ack): void {
    const session = this.requireLobbySession(socket, ack);
    if (!session) return;
    const parsed = roomCodeSchema.safeParse(payload);
    if (!parsed.success) {
      ack(failure("INVALID_ROOM", "Enter a valid five-character room code."));
      return;
    }
    const room = this.rooms.get(parsed.data.code);
    const owner = room ? this.sessions.get(room.ownerId) : undefined;
    if (!room || !owner || !owner.socketId || owner.matchId) {
      if (room) this.deleteRoom(room.code);
      ack(failure("ROOM_NOT_FOUND", "That room is unavailable or has expired."));
      return;
    }
    if (owner.id === session.id) {
      ack(failure("ROOM_OWNER", "You are already waiting in this room."));
      return;
    }
    if (owner.nickname.toLocaleLowerCase() === session.nickname.toLocaleLowerCase()) {
      ack(failure("DUPLICATE_NICKNAME", "Players in the same match need different nicknames."));
      return;
    }

    this.removeFromLobby(session);
    this.deleteRoom(room.code);
    owner.roomCode = null;
    this.startMatch(owner, session);
    ack(ok(undefined));
  }

  private handleInput(socket: GameSocket, payload: unknown): void {
    const session = this.sessionForSocket(socket);
    if (!session?.matchId || !session.side) return;
    const parsed = inputSchema.safeParse(payload);
    if (!parsed.success) return;
    const now = Date.now();
    if (now - session.inputWindowStarted >= 1_000) {
      session.inputWindowStarted = now;
      session.inputCount = 0;
    }
    session.inputCount += 1;
    if (session.inputCount > 120) return;
    const match = this.matches.get(session.matchId);
    if (!match || match.ended || match.disconnected.size > 0) return;
    applyInput(match.simulation, session.side, parsed.data.direction, parsed.data.sequence);
  }

  private requestRematch(socket: GameSocket, ack: Ack): void {
    const session = this.requireSession(socket, ack);
    if (!session?.matchId || !session.side) {
      ack(failure("NO_MATCH", "There is no completed match to replay."));
      return;
    }
    const match = this.matches.get(session.matchId);
    if (!match?.ended) {
      ack(failure("MATCH_ACTIVE", "The current match is not over yet."));
      return;
    }
    match.rematchRequests.add(session.side);
    this.io.to(match.id).emit("match:rematch-state", {
      requestedBy: [...match.rematchRequests],
      ready: match.rematchRequests.size === 2,
    });
    if (match.rematchRequests.size === 2) this.restartMatch(match);
    ack(ok(undefined));
  }

  private leaveMatch(socket: GameSocket, ack: Ack): void {
    const session = this.requireSession(socket, ack);
    if (!session) return;
    if (!session.matchId || !session.side) {
      ack(ok(undefined));
      return;
    }
    const match = this.matches.get(session.matchId);
    if (match && !match.ended) this.finishMatch(match, otherSide(session.side), "forfeit");
    this.releaseMatchForBoth(match, "Opponent left the table.");
    ack(ok(undefined));
  }

  private handleDisconnect(socket: GameSocket): void {
    const session = this.sessionForSocket(socket);
    if (!session || session.socketId !== socket.id) return;
    session.socketId = null;
    this.removeFromLobby(session);
    if (!session.matchId || !session.side) return;
    const match = this.matches.get(session.matchId);
    if (!match || match.ended) return;

    const side = session.side;
    match.simulation[side].connected = false;
    match.simulation[side].direction = 0;
    match.disconnected.add(side);
    if (match.simulation.phase !== "paused") {
      match.phaseBeforePause = match.simulation.phase;
      match.remainingBeforePause = match.simulation.phaseRemainingMs;
      match.simulation.phase = "paused";
      match.simulation.phaseEndsAt = null;
    }
    const deadline = Date.now() + this.reconnectGraceMs;
    this.io.to(match.id).emit("match:paused", {
      disconnectedPlayer: session.nickname,
      reconnectDeadline: deadline,
    });
    const timer = setTimeout(() => {
      if (!match.disconnected.has(side) || match.ended) return;
      this.finishMatch(match, otherSide(side), "forfeit");
    }, this.reconnectGraceMs);
    match.reconnectTimers.set(side, timer);
  }

  private startMatch(left: Session, right: Session): void {
    const id = randomUUID();
    const match: Match = {
      id,
      leftId: left.id,
      rightId: right.id,
      simulation: createSimulation(id, left, right),
      loop: null,
      disconnected: new Set(),
      reconnectTimers: new Map(),
      phaseBeforePause: null,
      remainingBeforePause: 0,
      rematchRequests: new Set(),
      ended: null,
      cleanupTimer: null,
    };
    this.matches.set(id, match);
    this.attachToMatch(left, match, "left");
    this.attachToMatch(right, match, "right");
    this.emitMatchReady(left, match);
    this.emitMatchReady(right, match);
    this.io.to(match.id).emit("match:snapshot", snapshot(match.simulation));
    this.startMatchLoop(match);
  }

  private startMatchLoop(match: Match): void {
    this.stopMatchLoop(match);
    const snapshotEvery = COURT.tickRate / COURT.snapshotRate;
    match.loop = setInterval(() => {
      if (match.ended) return;
      stepSimulation(match.simulation, 1 / COURT.tickRate);
      if (match.simulation.tick % snapshotEvery === 0) {
        this.io.to(match.id).emit("match:snapshot", snapshot(match.simulation));
      }
      if (match.simulation.phase === "finished" && match.simulation.winner) {
        this.finishMatch(match, match.simulation.winner, "score");
      }
    }, 1000 / COURT.tickRate);
  }

  private finishMatch(match: Match, winner: Side, reason: MatchEnded["reason"]): void {
    if (match.ended) return;
    this.stopMatchLoop(match);
    match.simulation.phase = "finished";
    match.simulation.winner = winner;
    match.simulation.phaseEndsAt = null;
    for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
    match.reconnectTimers.clear();
    const winnerSession = this.sessions.get(winner === "left" ? match.leftId : match.rightId)!;
    match.ended = {
      matchId: match.id,
      winner,
      winnerName: winnerSession.nickname,
      reason,
      score: { ...match.simulation.score },
    };
    this.io.to(match.id).emit("match:snapshot", snapshot(match.simulation));
    this.io.to(match.id).emit("match:ended", match.ended);
    match.cleanupTimer = setTimeout(() => {
      if (this.matches.get(match.id)?.ended) this.releaseMatchForBoth(match, "Completed table closed.");
    }, 5 * 60_000);
  }

  private restartMatch(match: Match): void {
    const left = this.sessions.get(match.leftId);
    const right = this.sessions.get(match.rightId);
    if (!left?.socketId || !right?.socketId) return;
    if (match.cleanupTimer) clearTimeout(match.cleanupTimer);
    match.cleanupTimer = null;
    match.simulation = createSimulation(match.id, left, right);
    match.ended = null;
    match.rematchRequests.clear();
    match.disconnected.clear();
    match.phaseBeforePause = null;
    this.emitMatchReady(left, match);
    this.emitMatchReady(right, match);
    this.io.to(match.id).emit("match:rematch-state", { requestedBy: [], ready: true });
    this.io.to(match.id).emit("match:snapshot", snapshot(match.simulation));
    this.startMatchLoop(match);
  }

  private resumeMatch(match: Match): void {
    match.simulation.phase = match.phaseBeforePause ?? "playing";
    match.simulation.phaseRemainingMs = match.remainingBeforePause;
    match.simulation.phaseEndsAt = match.simulation.phase === "countdown" || match.simulation.phase === "point"
      ? Date.now() + match.remainingBeforePause
      : null;
    match.phaseBeforePause = null;
    this.io.to(match.id).emit("match:resumed");
  }

  private attachToMatch(session: Session, match: Match, side: Side): void {
    this.removeFromLobby(session);
    session.matchId = match.id;
    session.side = side;
    session.socketId && this.io.sockets.sockets.get(session.socketId)?.join(match.id);
  }

  private emitMatchReady(session: Session, match: Match): void {
    if (!session.socketId || !session.side) return;
    const opponentId = session.side === "left" ? match.rightId : match.leftId;
    const opponent = this.sessions.get(opponentId)!;
    this.io.to(session.socketId).emit("match:ready", {
      matchId: match.id,
      side: session.side,
      opponent: opponent.nickname,
    });
  }

  private releaseMatchForBoth(match: Match | undefined, message: string): void {
    if (!match) return;
    this.stopMatchLoop(match);
    if (match.cleanupTimer) clearTimeout(match.cleanupTimer);
    for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
    for (const id of [match.leftId, match.rightId]) {
      const session = this.sessions.get(id);
      if (!session) continue;
      const socket = session.socketId ? this.io.sockets.sockets.get(session.socketId) : undefined;
      socket?.leave(match.id);
      this.detachFromMatch(session);
      socket?.emit("lobby:state", { mode: "idle", message });
    }
    this.matches.delete(match.id);
  }

  private stopMatchLoop(match: Match): void {
    if (match.loop) clearInterval(match.loop);
    match.loop = null;
  }

  private requireSession<T>(socket: GameSocket, ack: Ack<T>): Session | null {
    const session = this.sessionForSocket(socket);
    if (!session) ack(failure("NOT_REGISTERED", "Choose a nickname before joining a game."));
    return session;
  }

  private requireLobbySession<T>(socket: GameSocket, ack: Ack<T>): Session | null {
    const session = this.requireSession(socket, ack);
    if (session?.matchId) {
      ack(failure("ALREADY_IN_MATCH", "Leave your current match before joining another."));
      return null;
    }
    return session;
  }

  private sessionForSocket(socket: GameSocket): Session | null {
    return socket.data.playerId ? this.sessions.get(socket.data.playerId) ?? null : null;
  }

  private sessionInfo(session: Session, resumed: boolean): SessionInfo {
    return {
      playerId: session.id,
      nickname: session.nickname,
      sessionToken: session.token,
      resumed,
    };
  }

  private removeFromLobby(session: Session): void {
    if (session.queueing) this.removeQueueId(session.id);
    session.queueing = false;
    if (session.roomCode) this.deleteRoom(session.roomCode);
    session.roomCode = null;
  }

  private removeQueueId(id: string): void {
    let index = this.quickQueue.indexOf(id);
    while (index >= 0) {
      this.quickQueue.splice(index, 1);
      index = this.quickQueue.indexOf(id);
    }
  }

  private deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room) clearTimeout(room.expires);
    this.rooms.delete(code);
  }

  private expireRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);
    const owner = this.sessions.get(room.ownerId);
    if (!owner || owner.roomCode !== code) return;
    owner.roomCode = null;
    if (owner.socketId) {
      this.io.to(owner.socketId).emit("lobby:state", { mode: "idle", message: "Room expired. Create another to keep waiting." });
    }
  }

  private uniqueRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    do {
      let code = "";
      for (let index = 0; index < 5; index += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) return code;
    } while (true);
  }

  private detachFromMatch(session: Session): void {
    session.matchId = null;
    session.side = null;
  }
}

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}
