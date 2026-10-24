import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT } from "@ai-office/shared";
import { EventStore } from "./store";
import { SessionRegistry } from "./sessions";
import { registerWs } from "./ws";
import { registerEventRoutes } from "./routes/events";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const webOrigins = (
  process.env.AI_OFFICE_WEB_ORIGINS ??
  `http://localhost:${DEFAULT_WEB_PORT},http://127.0.0.1:${DEFAULT_WEB_PORT}`
).split(",");

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, bodyLimit: 64 * 1024 });
await app.register(cors, { origin: webOrigins });
await app.register(websocket, {
  options: {
    // Reject cross-site pages connecting to the local socket.
    verifyClient: ({ origin }: { origin?: string }) => !origin || webOrigins.includes(origin),
  },
});

const store = new EventStore();
const sessions = new SessionRegistry();
const { broadcast } = registerWs(app, store, sessions);
registerEventRoutes(app, store, sessions, broadcast);
app.get("/health", async () => ({ ok: true }));

await app.listen({ host, port });
