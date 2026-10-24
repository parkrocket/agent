import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { OfficeConfig, OfficeEvent, OfficeState, OfficeUpdate, ServerMessage } from "@ai-office/shared";
import type { EventStore } from "./store";
import type { OfficeRegistry } from "./office";

export function registerWs(
  app: FastifyInstance,
  store: EventStore,
  office: OfficeRegistry,
  config: OfficeConfig,
  allowedOrigins: string[],
) {
  const clients = new Set<WebSocket>();

  // Reject cross-site pages connecting to the local socket (non-browser clients send no Origin).
  const checkOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return reply.code(403).send({ error: "origin not allowed" });
  };

  app.get("/ws", { websocket: true, preValidation: checkOrigin }, (socket) => {
    clients.add(socket);
    const { sessions, rooms } = office.state;
    send(socket, { type: "snapshot", events: store.recent(), sessions, rooms, config });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  const broadcast = (message: ServerMessage) => {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  };

  return {
    broadcastEvent(event: OfficeEvent, update: OfficeUpdate) {
      broadcast({ type: "event", event, session: update.session, room: update.room });
      if (update.pruned) this.broadcastState(update.state);
    },
    broadcastState(state: OfficeState) {
      broadcast({ type: "state", sessions: state.sessions, rooms: state.rooms });
    },
  };
}

function send(socket: WebSocket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}
