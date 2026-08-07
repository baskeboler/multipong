// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { MatchStatus, MultiplayerState } from "./network/useMultiplayer";

const state = vi.hoisted(() => ({ current: null as MultiplayerState | null }));

vi.mock("./audio/arcadeSound", () => ({
  arcadeSound: { isMuted: () => false, toggle: () => true },
}));
vi.mock("./network/useMultiplayer", () => ({
  useMultiplayer: () => state.current,
  savedNickname: () => "",
}));
vi.mock("./game/GameCanvas", () => ({ GameCanvas: () => <div data-testid="canvas" /> }));

function baseState(): MultiplayerState {
  return {
    connected: true,
    session: null,
    lobby: { mode: "idle", message: "Ready" },
    match: null,
    status: null,
    paused: null,
    ended: null,
    rematch: { requestedBy: [], ready: false },
    error: null,
    register: vi.fn(),
    joinQueue: vi.fn(),
    leaveLobby: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    sendInput: vi.fn(),
    requestRematch: vi.fn(),
    leaveMatch: vi.fn(),
    clearError: vi.fn(),
  };
}

describe("Multipong React shell", () => {
  beforeEach(() => { state.current = baseState(); });

  it("validates and submits a guest nickname", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: /enter multipong/i });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByTestId("nickname"), { target: { value: "Nova" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(state.current?.register).toHaveBeenCalledWith("Nova");
  });

  it("shows all three matchmaking routes to a registered player", () => {
    state.current = { ...baseState(), session: { playerId: "1", nickname: "Nova", sessionToken: "token", resumed: false } };
    render(<App />);
    expect(screen.getByTestId("quick-match")).toBeVisible();
    expect(screen.getByTestId("create-room")).toBeVisible();
    expect(screen.getByTestId("join-room")).toBeDisabled();
  });

  it("renders the final score and sends a rematch request", () => {
    const status: MatchStatus = {
      phase: "finished",
      phaseEndsAt: null,
      score: { left: 7, right: 4 },
      connected: { left: true, right: true },
    };
    state.current = {
      ...baseState(),
      session: { playerId: "1", nickname: "Nova", sessionToken: "token", resumed: false },
      match: {
        matchId: "match",
        side: "left",
        players: {
          left: { id: "1", nickname: "Nova" },
          right: { id: "2", nickname: "Rival" },
        },
      },
      status,
      ended: { matchId: "match", winner: "left", winnerName: "Nova", reason: "score", score: status.score },
    };
    render(<App />);
    expect(screen.getByText("Grid conquered")).toBeVisible();
    expect(screen.getByText(/Nova wins 7–4/)).toBeVisible();
    fireEvent.click(screen.getByTestId("rematch"));
    expect(state.current!.requestRematch).toHaveBeenCalledOnce();
  });
});
