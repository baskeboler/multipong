import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type { ClientToServerEvents, MatchEnded, MatchReady, MatchSnapshot, PausedState, ServerToClientEvents, SessionInfo } from "../shared/protocol.js";
import { MultiplayerServer } from "./multiplayer.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("multiplayer server", () => {
  let httpServer: HttpServer;
  let multiplayer: MultiplayerServer;
  let url: string;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    multiplayer = new MultiplayerServer(httpServer, { reconnectGraceMs: 250, privateRoomLifetimeMs: 500 });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", reject);
        resolve();
      });
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    clients.length = 0;
    await multiplayer.close();
  });

  it("creates a private room and starts a match when the code is joined", async () => {
    const host = await connect();
    const guest = await connect();
    await register(host, "Laser");
    await register(guest, "Ghost");
    const code = await new Promise<string>((resolve, reject) => host.emit("room:create", (result) => result.ok ? resolve(result.data.code) : reject(result.error)));
    const hostReady = once<MatchReady>(host, "match:ready");
    const guestReady = once<MatchReady>(guest, "match:ready");
    await new Promise<void>((resolve, reject) => guest.emit("room:join", { code }, (result) => result.ok ? resolve() : reject(result.error)));
    const ready = await hostReady;
    expect(ready.side).toBe("left");
    expect(ready.players.left.nickname).toBe("Laser");
    expect((await guestReady).side).toBe("right");
  });

  it("pairs two players from the public queue", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "Alpha");
    await register(second, "Beta");
    const firstReady = once<MatchReady>(first, "match:ready");
    const secondReady = once<MatchReady>(second, "match:ready");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    expect((await firstReady).players.right.nickname).toBe("Beta");
    expect((await secondReady).players.left.nickname).toBe("Alpha");
  });

  it("rejects unknown private room codes", async () => {
    const client = await connect();
    await register(client, "Rogue");
    const result = await new Promise<Parameters<Parameters<ClientToServerEvents["room:join"]>[1]>[0]>((resolve) => client.emit("room:join", { code: "AAAAA" }, resolve));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("pauses and restores a live match with the reconnect token", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "North");
    const secondSession = await register(second, "South");
    const ready = once<MatchReady>(first, "match:ready");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    await ready;
    const paused = once<PausedState>(first, "match:paused");
    second.disconnect();
    expect((await paused).disconnectedPlayer).toBe("South");

    const resumed = once<void>(first, "match:resumed");
    const replacement: TestClient = createClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      forceNew: true,
      auth: { sessionToken: secondSession.sessionToken },
    });
    clients.push(replacement);
    const restoredPromise = once<SessionInfo>(replacement, "session:ready");
    const connectedPromise = once<void>(replacement, "connect");
    replacement.connect();
    await connectedPromise;
    const restored = await restoredPromise;
    expect(restored.resumed).toBe(true);
    await resumed;
  });

  it("awards a forfeit when a disconnected player misses the grace period", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "Stay");
    await register(second, "Gone");
    const ready = once<MatchReady>(first, "match:ready");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    await ready;
    const ended = once<MatchEnded>(first, "match:ended");
    second.disconnect();
    const result = await ended;
    expect(result.reason).toBe("forfeit");
    expect(result.winnerName).toBe("Stay");
  });

  it("does not publish periodic snapshots while a match is paused", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "Still");
    await register(second, "Paused");
    let snapshots = 0;
    first.on("match:snapshot", () => {
      snapshots += 1;
    });
    const ready = once<MatchReady>(first, "match:ready");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    await ready;
    const paused = once<PausedState>(first, "match:paused");
    second.disconnect();
    await paused;
    await delay(30);
    const countAfterPause = snapshots;
    await delay(100);
    expect(snapshots).toBe(countAfterPause);
  });

  it("keeps player identity out of repeated snapshots", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "Compact");
    await register(second, "Payload");
    const nextSnapshot = once<MatchSnapshot>(first, "match:snapshot");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    const state = await nextSnapshot;
    expect(state.left).not.toHaveProperty("id");
    expect(state.left).not.toHaveProperty("nickname");
    expect(state.right).not.toHaveProperty("id");
    expect(state.right).not.toHaveProperty("nickname");
  });

  it("starts a fresh countdown when both players accept a rematch", async () => {
    const first = await connect();
    const second = await connect();
    await register(first, "Again");
    const secondSession = await register(second, "Encore");
    const firstReady = once<MatchReady>(first, "match:ready");
    await ack(first, "queue:join");
    await ack(second, "queue:join");
    await firstReady;
    const ended = once<MatchEnded>(first, "match:ended");
    second.disconnect();
    await ended;

    const replacement: TestClient = createClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      forceNew: true,
      auth: { sessionToken: secondSession.sessionToken },
    });
    clients.push(replacement);
    const restored = once<SessionInfo>(replacement, "session:ready");
    replacement.connect();
    await restored;
    const replayForFirst = once<MatchReady>(first, "match:ready");
    const replayForSecond = once<MatchReady>(replacement, "match:ready");
    await ack(first, "match:rematch");
    await ack(replacement, "match:rematch");
    expect((await replayForFirst).players.right.nickname).toBe("Encore");
    expect((await replayForSecond).players.left.nickname).toBe("Again");
  });

  async function connect(token?: string): Promise<TestClient> {
    const client: TestClient = createClient(url, { transports: ["websocket"], forceNew: true, auth: { sessionToken: token } });
    clients.push(client);
    if (client.connected) return client;
    await once<void>(client, "connect");
    return client;
  }
});

async function register(client: TestClient, nickname: string): Promise<SessionInfo> {
  return new Promise((resolve, reject) => client.emit("session:register", { nickname }, (result) => result.ok ? resolve(result.data) : reject(result.error)));
}

async function ack(client: TestClient, event: "queue:join" | "queue:leave" | "match:rematch" | "match:leave"): Promise<void> {
  return new Promise((resolve, reject) => client.emit(event, (result) => result.ok ? resolve() : reject(result.error)));
}

function once<T>(client: TestClient, event: string): Promise<T> {
  return new Promise((resolve) => client.once(event as never, resolve as never));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
