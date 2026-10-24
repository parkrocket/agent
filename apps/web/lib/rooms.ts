import { roomActivity, roomLabels, type RoomActivity, type RoomMap, type RoomState, type SessionMap } from "@ai-office/shared";

export interface RoomSummary {
  room: RoomState;
  label: string;
  activity: RoomActivity;
  /** Sessions currently at work in the room. */
  present: number;
}

/** Rooms in a stable order (first seen) so tabs don't jump around; empty rooms go last. */
export function summarizeRooms(rooms: RoomMap, sessions: SessionMap): RoomSummary[] {
  const list = Object.values(rooms);
  const labels = roomLabels(list);
  return list
    .map((room) => ({
      room,
      label: labels[room.key] ?? room.project,
      activity: roomActivity(room, sessions),
      present: room.pods.filter((id) => id && sessions[id] && !sessions[id].offDuty).length,
    }))
    .sort((a, b) => Number(a.activity === "empty") - Number(b.activity === "empty") || a.room.firstSeenAt - b.room.firstSeenAt);
}

export const AUTO_LOBBY_MAX_ROOMS = 2;
