import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MultiplayerServer } from "./multiplayer.js";

const port = Number(process.env.PORT ?? 3001);
const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "multipong", timestamp: new Date().toISOString() });
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const clientDirectory = resolve(currentDirectory, "../../client");
if (existsSync(clientDirectory)) {
  app.use(express.static(clientDirectory));
  app.get("/{*path}", (_request, response) => response.sendFile(resolve(clientDirectory, "index.html")));
}

const multiplayer = new MultiplayerServer(httpServer, {
  clientOrigin: process.env.CLIENT_ORIGIN ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:5173"),
});

httpServer.listen(port, () => {
  console.log(`Multipong server listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  await multiplayer.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
