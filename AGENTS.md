# Repository Guidelines

## Project Structure & Module Organization

Multipong has a React/Phaser client and a server-authoritative Node.js/Socket.IO backend.

- `src/client/`: React UI, Phaser game rendering, input, audio, networking, and global CSS.
- `src/server/`: HTTP/socket server, matchmaking, and deterministic game simulation.
- `src/shared/protocol.ts`: shared event types, Zod payload schemas, and game constants.
- `tests/e2e/`: Playwright browser flows; colocated `*.test.ts` and `*.test.tsx` files cover server and client behavior.
- `dist/`, `coverage/`, and `test-results/`: generated output; do not commit or edit these directories.

Keep authoritative game rules on the server. The client should render snapshots, predict local input, and communicate through the shared protocol rather than duplicate server state.

## Build, Test, and Development Commands

Use Node.js 20 or newer and install dependencies with `npm install`.

- `npm run dev`: start the Vite client on port 5173 and the watched server on port 3001.
- `npm run typecheck`: validate both browser and server TypeScript configurations.
- `npm test`: run all Vitest tests once; use `npm run test:watch` while developing.
- `npm run build`: produce client and server artifacts under `dist/`.
- `npm start`: run the built production server.
- `npm run test:e2e`: build the app and run Chromium Playwright tests. Install Chromium first with `npx playwright install chromium` if needed.

## Coding Style & Naming Conventions

Follow the existing two-space indentation, double quotes, semicolons, and trailing commas in multiline constructs. TypeScript strict mode is enabled; avoid `any`, define explicit boundary types, and validate network input with Zod. Use `PascalCase` for React components and exported interfaces, `camelCase` for functions and values, and descriptive filenames such as `usePaddleInput.ts` or `simulation.test.ts`. There is no configured formatter or linter, so preserve the surrounding style and run type checks before submitting.

## Testing Guidelines

Use Vitest for unit/integration tests and Testing Library for React behavior. Name colocated tests `*.test.ts(x)`. Put complete two-browser matchmaking or reconnect scenarios in `tests/e2e/*.spec.ts`. Add regression coverage for changed simulation, socket lifecycle, and user-visible behavior. No coverage threshold is enforced; prioritize meaningful state transitions and protocol edge cases.

## Commit & Pull Request Guidelines

History contains only `initial commit.`, so no formal commit convention is established. Prefer concise, imperative subjects (for example, `Handle reconnect timeout`). Pull requests should explain the behavior change, list verification commands, link relevant issues, and include screenshots or recordings for visible UI changes. Call out protocol or configuration changes explicitly; never commit `.env` or generated artifacts.
