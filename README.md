# Multipong

A server-authoritative, real-time multiplayer Pong game built with React, Phaser, Node.js, TypeScript, and Socket.IO.

## Features

- Public quick matchmaking and private five-character room codes
- Fixed-step 60 Hz server simulation with 20 Hz snapshots
- Client-side local paddle prediction and buffered remote interpolation
- Guest nickname sessions with a 20-second reconnect window
- First-to-seven matches, forfeit handling, and mutual rematches
- Desktop keyboard controls (`W`/`S` or arrow keys)
- Neon Phaser court with a responsive React lobby, HUD, and overlays
- Synthesized arcade sound, mute preference, and reduced-motion support

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in two browser windows. The Socket.IO server runs on `http://localhost:3001`.

To run the production build as one Node application:

```bash
npm run build
npm start
```

The production server uses port `3001` by default and exposes `GET /health`.

## Configuration

Copy `.env.example` or provide the variables through your process manager:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Production HTTP and Socket.IO port | `3001` |
| `CLIENT_ORIGIN` | Allowed Vite development origin | `http://localhost:5173` |
| `VITE_SERVER_URL` | Socket.IO URL used by the development client | Current page origin |

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The integration tests bind a temporary localhost port. Playwright requires its Chromium browser (`npx playwright install chromium`) if it is not already available.

## Architecture

- `src/server/simulation.ts` owns deterministic paddle movement, ball physics, scoring, and match phases.
- `src/server/multiplayer.ts` owns guest sessions, matchmaking, rooms, match loops, reconnects, and rematches.
- `src/shared/protocol.ts` defines runtime-validated Socket.IO payloads and shared snapshots.
- React owns lobby and HUD state. Phaser is a disposable renderer that reads interpolated snapshots through `gameBridge`.

All match and room state is intentionally held in one Node process. Durable statistics, accounts, spectators, touch controls, and multi-instance coordination are outside this release.
