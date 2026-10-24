import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { OfficeEvent, ServerMessage } from "@ai-office/shared";
import type { EventStore } from "./store";

export function registerWs(app: FastifyInstance, store: EventStore) {
  const clients = new Set<WebSocket>();

  app.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);
    send(socket, { type: "snapshot", events: store.recent() });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  return {
    broadcast(event: OfficeEvent) {
      const data = JSON.stringify({ type: "event", event } satisfies ServerMessage);
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(data);
      }
    },
  };
}

function send(socket: WebSocket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}
