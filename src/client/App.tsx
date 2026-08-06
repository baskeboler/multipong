import { lazy, Suspense, useEffect, useState } from "react";
import { arcadeSound } from "./audio/arcadeSound";
import { usePaddleInput } from "./input/usePaddleInput";
import { savedNickname, useMultiplayer, type MultiplayerState } from "./network/useMultiplayer";
import type { MatchSnapshot, Side } from "../shared/protocol";

const GameCanvas = lazy(() => import("./game/GameCanvas").then((module) => ({ default: module.GameCanvas })));

export function App(): React.JSX.Element {
  const multiplayer = useMultiplayer();
  const [muted, setMuted] = useState(arcadeSound.isMuted());
  usePaddleInput(Boolean(multiplayer.match && !multiplayer.ended && !multiplayer.paused), multiplayer.sendInput);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <Brand compact={Boolean(multiplayer.match)} />
        <div className="topbar-actions">
          <span className={`connection ${multiplayer.connected ? "is-online" : ""}`}>
            <span className="connection-dot" />
            {multiplayer.connected ? "Live" : "Reconnecting"}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label={muted ? "Unmute sound" : "Mute sound"}
            onClick={() => setMuted(arcadeSound.toggle())}
          >
            {muted ? "Sound off" : "Sound on"}
          </button>
        </div>
      </header>

      {!multiplayer.session ? (
        <Welcome onRegister={multiplayer.register} connected={multiplayer.connected} />
      ) : !multiplayer.match ? (
        <Lobby multiplayer={multiplayer} />
      ) : (
        <MatchView multiplayer={multiplayer} />
      )}

      {multiplayer.error && (
        <div className="toast" role="alert">
          <div><strong>Signal interrupted</strong><span>{multiplayer.error.message}</span></div>
          <button type="button" onClick={multiplayer.clearError} aria-label="Dismiss error">×</button>
        </div>
      )}
    </main>
  );
}

function Brand({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={`brand ${compact ? "is-compact" : ""}`}>
      <span className="brand-mark"><i /><i /><i /></span>
      <span>MULTI<strong>PONG</strong></span>
    </div>
  );
}

function Welcome({ onRegister, connected }: { onRegister: (nickname: string) => void; connected: boolean }): React.JSX.Element {
  const [nickname, setNickname] = useState(savedNickname());
  const valid = nickname.trim().length >= 2 && nickname.trim().length <= 16;
  return (
    <section className="landing">
      <div className="hero-copy">
        <p className="eyebrow"><span /> Real-time two-player arcade</p>
        <h1>Own the angle.<br /><em>Rule the grid.</em></h1>
        <p className="hero-description">Classic Pong, rebuilt for fast online duels. No account. No grind. Just you, an opponent, and seven points.</p>
        <div className="feature-row">
          <span><b>60</b> Hz server</span>
          <span><b>7</b> points to win</span>
          <span><b>20</b> sec reconnect</span>
        </div>
      </div>
      <form className="glass-card identity-card" onSubmit={(event) => { event.preventDefault(); if (valid) onRegister(nickname.trim()); }}>
        <span className="card-index">PLAYER // 01</span>
        <h2>Enter the arena</h2>
        <p>Pick the name your opponent will remember.</p>
        <label htmlFor="nickname">Callsign</label>
        <input
          id="nickname"
          data-testid="nickname"
          autoFocus
          autoComplete="nickname"
          maxLength={16}
          placeholder="NEON GHOST"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
        />
        <div className="field-note"><span>{nickname.trim().length}/16</span><span>2 characters minimum</span></div>
        <button className="primary-button" type="submit" disabled={!valid || !connected}>
          {connected ? "Enter Multipong" : "Connecting…"}<span>↗</span>
        </button>
        <p className="fine-print">A temporary session keeps your seat if the signal drops.</p>
      </form>
    </section>
  );
}

function Lobby({ multiplayer }: { multiplayer: MultiplayerState }): React.JSX.Element {
  const [code, setCode] = useState("");
  const waiting = multiplayer.lobby.mode !== "idle";
  const initials = multiplayer.session?.nickname.slice(0, 2).toUpperCase();
  return (
    <section className="lobby-page">
      <div className="lobby-heading">
        <div><p className="eyebrow"><span /> Arena ready</p><h1>Choose your <em>match.</em></h1></div>
        <div className="player-chip"><span>{initials}</span><div><small>Signed in as</small><strong>{multiplayer.session?.nickname}</strong></div></div>
      </div>

      {waiting ? (
        <div className="glass-card waiting-card" data-testid="waiting-room">
          <div className="radar"><span /><i /><i /><i /></div>
          <p className="eyebrow">Searching</p>
          <h2>{multiplayer.lobby.mode === "private-room" ? "Private channel open" : "Finding your rival"}</h2>
          <p>{multiplayer.lobby.message}</p>
          {multiplayer.lobby.roomCode && <button className="room-code" type="button" onClick={() => navigator.clipboard?.writeText(multiplayer.lobby.roomCode!)}>{multiplayer.lobby.roomCode}<small>Click to copy</small></button>}
          <button className="text-button" type="button" onClick={multiplayer.leaveLobby}>Cancel and return</button>
        </div>
      ) : (
        <div className="match-options">
          <article className="glass-card option-card featured">
            <span className="option-number">01</span><span className="option-icon">⌁</span>
            <div><small>Fastest route</small><h2>Quick match</h2><p>Enter the public grid and face the next available player.</p></div>
            <button data-testid="quick-match" className="primary-button" type="button" onClick={multiplayer.joinQueue}>Find an opponent <span>↗</span></button>
          </article>
          <article className="glass-card option-card">
            <span className="option-number">02</span><span className="option-icon cyan">＋</span>
            <div><small>Host a duel</small><h2>Create room</h2><p>Open a private table and share its five-character access code.</p></div>
            <button data-testid="create-room" className="secondary-button" type="button" onClick={multiplayer.createRoom}>Create private room</button>
          </article>
          <article className="glass-card option-card">
            <span className="option-number">03</span><span className="option-icon pink">#</span>
            <div><small>Have a code?</small><h2>Join room</h2><p>Meet a friend at their private table.</p></div>
            <form onSubmit={(event) => { event.preventDefault(); if (code.length === 5) multiplayer.joinRoom(code); }}>
              <input data-testid="room-code-input" aria-label="Room code" className="code-input" maxLength={5} placeholder="A7K9Q" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <button data-testid="join-room" className="secondary-button" disabled={code.length !== 5}>Join</button>
            </form>
          </article>
        </div>
      )}
      <div className="controls-strip"><span>CONTROLS</span><kbd>W</kbd><kbd>S</kbd><small>or</small><kbd>↑</kbd><kbd>↓</kbd><p>Move your paddle. Read the angle. Hold the line.</p></div>
    </section>
  );
}

function MatchView({ multiplayer }: { multiplayer: MultiplayerState }): React.JSX.Element {
  const state = multiplayer.snapshot;
  const countdown = useCountdown(state);
  const yourSide = multiplayer.match!.side;
  const resultText = multiplayer.ended?.winner === yourSide ? "Grid conquered" : "Run it back";
  const requested = multiplayer.rematch.requestedBy.includes(yourSide);
  return (
    <section className="match-page" data-testid="match-view">
      <div className="scoreboard">
        <PlayerScore side="left" state={state} yours={yourSide === "left"} />
        <div className="round-status"><span>{multiplayer.paused ? "SIGNAL HOLD" : state?.phase === "playing" ? "LIVE ROUND" : "STANDBY"}</span><small>FIRST TO 7</small></div>
        <PlayerScore side="right" state={state} yours={yourSide === "right"} />
      </div>
      <div className="court-frame"><Suspense fallback={<div className="canvas-loading">SYNCING COURT…</div>}><GameCanvas /></Suspense></div>
      <div className="match-controls"><span><kbd>W</kbd><kbd>S</kbd> MOVE</span><span className="latency-note">SERVER AUTHORITATIVE // 60 HZ</span><span><kbd>↑</kbd><kbd>↓</kbd> MOVE</span></div>

      {countdown && !multiplayer.paused && <div className="center-callout" aria-live="polite"><small>ROUND STARTS IN</small><strong>{countdown}</strong></div>}
      {multiplayer.paused && (
        <div className="modal-backdrop"><div className="glass-card result-card"><span className="pulse-icon">⌁</span><p className="eyebrow">Connection pause</p><h2>Holding the table</h2><p>{multiplayer.paused.disconnectedPlayer} has 20 seconds to reconnect.</p></div></div>
      )}
      {multiplayer.ended && (
        <div className="modal-backdrop" data-testid="match-result"><div className="glass-card result-card">
          <span className="card-index">MATCH COMPLETE</span><h2>{resultText}</h2>
          <p>{multiplayer.ended.winnerName} wins {multiplayer.ended.score.left}–{multiplayer.ended.score.right}{multiplayer.ended.reason === "forfeit" ? " by forfeit" : ""}.</p>
          <button data-testid="rematch" className="primary-button" disabled={requested} onClick={multiplayer.requestRematch}>{requested ? "Waiting for opponent…" : "Request rematch"}<span>↻</span></button>
          <button className="text-button" onClick={multiplayer.leaveMatch}>Return to lobby</button>
        </div></div>
      )}
    </section>
  );
}

function PlayerScore({ side, state, yours }: { side: Side; state: MatchSnapshot | null; yours: boolean }): React.JSX.Element {
  const player = state?.[side];
  return <div className={`player-score ${side}`}><div><small>{yours ? "YOU" : "RIVAL"}</small><strong>{player?.nickname ?? "—"}</strong></div><b>{state?.score[side] ?? 0}</b></div>;
}

function useCountdown(state: MatchSnapshot | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state?.phase !== "countdown" || !state.phaseEndsAt) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [state?.phase, state?.phaseEndsAt]);
  if (state?.phase !== "countdown" || !state.phaseEndsAt) return null;
  return Math.max(1, Math.ceil((state.phaseEndsAt - now) / 1000));
}
