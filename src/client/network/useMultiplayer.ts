import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ApiError,
  ClientToServerEvents,
  Direction,
  LobbyState,
  MatchEnded,
  MatchPhase,
  MatchReady,
  MatchSnapshot,
  PausedState,
  RematchState,
  ServerToClientEvents,
  SessionInfo,
  Side,
} from "../../shared/protocol";
import { gameBridge } from "./gameBridge";

const TOKEN_KEY = "multipong-session";
const NICKNAME_KEY = "multipong-nickname";

export interface MultiplayerState {
  connected: boolean;
  session: SessionInfo | null;
  lobby: LobbyState;
  match: MatchReady | null;
  status: MatchStatus | null;
  paused: PausedState | null;
  ended: MatchEnded | null;
  rematch: RematchState;
  error: ApiError | null;
  register: (nickname: string) => void;
  joinQueue: () => void;
  leaveLobby: () => void;
  createRoom: () => void;
  joinRoom: (code: string) => void;
  sendInput: (direction: Direction, sequence: number) => void;
  requestRematch: () => void;
  leaveMatch: () => void;
  clearError: () => void;
}

export interface MatchStatus {
  phase: MatchPhase;
  phaseEndsAt: number | null;
  score: Record<Side, number>;
  connected: Record<Side, boolean>;
}

export function useMultiplayer(): MultiplayerState {
  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents>>(
    () =>
      io(import.meta.env.VITE_SERVER_URL || window.location.origin, {
        autoConnect: false,
        auth: { sessionToken: localStorage.getItem(TOKEN_KEY) ?? undefined },
        transports: ["websocket", "polling"],
      }),
    [],
  );
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [lobby, setLobby] = useState<LobbyState>({
    mode: "idle",
    message: "Choose how you want to play.",
  });
  const [match, setMatch] = useState<MatchReady | null>(null);
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [paused, setPaused] = useState<PausedState | null>(null);
  const [ended, setEnded] = useState<MatchEnded | null>(null);
  const [rematch, setRematch] = useState<RematchState>({
    requestedBy: [],
    ready: false,
  });
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const onSession = (nextSession: SessionInfo) => {
      localStorage.setItem(TOKEN_KEY, nextSession.sessionToken);
      localStorage.setItem(NICKNAME_KEY, nextSession.nickname);
      setSession(nextSession);
    };
    const onLobby = (state: LobbyState) => {
      setLobby(state);
      if (state.mode === "idle") {
        setMatch(null);
        setStatus(null);
        setPaused(null);
        setEnded(null);
        setRematch({ requestedBy: [], ready: false });
        gameBridge.reset();
      }
    };
    const onMatchReady = (ready: MatchReady) => {
      setMatch(ready);
      setEnded(null);
      setPaused(null);
      setRematch({ requestedBy: [], ready: false });
      gameBridge.reset();
      gameBridge.setSide(ready.side);
    };
    const onSnapshot = (state: MatchSnapshot) => {
      gameBridge.push(state);
      const nextStatus = matchStatus(state);
      setStatus((current) =>
        current && equalMatchStatus(current, nextStatus)
          ? current
          : nextStatus,
      );
    };
    const onEnded = (result: MatchEnded) => {
      setEnded(result);
      setPaused(null);
      gameBridge.setDirection(0);
    };

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () =>
      setError({
        code: "CONNECTION_FAILED",
        message: "Could not reach the game server.",
      }),
    );
    socket.on("session:ready", onSession);
    socket.on("lobby:state", onLobby);
    socket.on("match:ready", onMatchReady);
    socket.on("match:snapshot", onSnapshot);
    socket.on("match:paused", setPaused);
    socket.on("match:resumed", () => setPaused(null));
    socket.on("match:ended", onEnded);
    socket.on("match:rematch-state", setRematch);
    socket.on("server:error", setError);
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      gameBridge.reset();
    };
  }, [socket]);

  const register = useCallback(
    (nickname: string) => {
      socket.emit("session:register", { nickname }, (result) => {
        if (!result.ok) setError(result.error);
        else setSession(result.data);
      });
    },
    [socket],
  );

  const joinQueue = useCallback(() => {
    socket.emit("queue:join", (result) => !result.ok && setError(result.error));
  }, [socket]);

  const leaveLobby = useCallback(() => {
    socket.emit(
      "queue:leave",
      (result) => !result.ok && setError(result.error),
    );
  }, [socket]);

  const createRoom = useCallback(() => {
    socket.emit(
      "room:create",
      (result) => !result.ok && setError(result.error),
    );
  }, [socket]);

  const joinRoom = useCallback(
    (code: string) => {
      socket.emit(
        "room:join",
        { code },
        (result) => !result.ok && setError(result.error),
      );
    },
    [socket],
  );

  const sendInput = useCallback(
    (direction: Direction, sequence: number) => {
      if (!socket.connected) return;
      socket.emit("match:input", { direction, sequence });
    },
    [socket],
  );

  const requestRematch = useCallback(() => {
    socket.emit(
      "match:rematch",
      (result) => !result.ok && setError(result.error),
    );
  }, [socket]);

  const leaveMatch = useCallback(() => {
    socket.emit(
      "match:leave",
      (result) => !result.ok && setError(result.error),
    );
  }, [socket]);

  return {
    connected,
    session,
    lobby,
    match,
    status,
    paused,
    ended,
    rematch,
    error,
    register,
    joinQueue,
    leaveLobby,
    createRoom,
    joinRoom,
    sendInput,
    requestRematch,
    leaveMatch,
    clearError: () => setError(null),
  };
}

function matchStatus(snapshot: MatchSnapshot): MatchStatus {
  return {
    phase: snapshot.phase,
    phaseEndsAt: snapshot.phaseEndsAt,
    score: { ...snapshot.score },
    connected: {
      left: snapshot.left.connected,
      right: snapshot.right.connected,
    },
  };
}

function equalMatchStatus(left: MatchStatus, right: MatchStatus): boolean {
  return (
    left.phase === right.phase &&
    left.score.left === right.score.left &&
    left.score.right === right.score.right &&
    left.connected.left === right.connected.left &&
    left.connected.right === right.connected.right
  );
}

export function savedNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? "";
}
