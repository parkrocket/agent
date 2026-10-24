// Room layout in base (unscaled) pixels, relative to the room's top-left.
// A room holds one pod per session (lead desk + staff desks), two pods per
// row. A "seat" is where a seated character's feet go: just behind the
// desk's top edge, so the desk hides the legs and the hands rest on it.
import { SUB_DESK_COUNT } from "@ai-office/shared";
import { DESK_H, DESK_W, LEAD_DESK_H, LEAD_DESK_W, MONITOR_H, MONITOR_W, WALL_H } from "./sprites";

export interface Point {
  x: number;
  y: number;
}

export interface DeskSpot {
  pod: number;
  index: number;
  /** Desk top-left. */
  desk: Point;
  w: number;
  h: number;
  seat: Point;
  /** Monitor top-left, on the desk to the right of the seat. */
  monitor: Point;
  lead: boolean;
}

export const POD_W = 264; // 240 of desks + an aisle between neighbouring pods
export const POD_H = 150;
export const PODS_PER_ROW = 2;
const ROOM_LEFT = 52; // door aisle
const ROOM_RIGHT = 56; // bookshelf, cooler, standing spots
const POD_TOP = 42;
const POD_CONTENT_H = 140;
const ROOM_BOTTOM = 26;

/** Room size for a number of pods; an empty room is drawn at one-pod size. */
export function roomSize(pods: number): { w: number; h: number } {
  const n = Math.max(1, pods);
  const cols = Math.min(PODS_PER_ROW, n);
  const rows = Math.ceil(n / PODS_PER_ROW);
  return {
    w: ROOM_LEFT + cols * POD_W + ROOM_RIGHT,
    h: POD_TOP + (rows - 1) * POD_H + POD_CONTENT_H + ROOM_BOTTOM,
  };
}

export function podOrigin(pod: number): Point {
  return { x: ROOM_LEFT + (pod % PODS_PER_ROW) * POD_W, y: POD_TOP + Math.floor(pod / PODS_PER_ROW) * POD_H };
}

/** Just inside the door. */
export const DOOR: Point = { x: 26, y: WALL_H + 4 };
/** Outside the door; walking here makes a character disappear through it. */
export const DOOR_OUT: Point = { x: 26, y: WALL_H - 2 };

function spot(pod: number, index: number, rx: number, ry: number, lead = false): DeskSpot {
  const o = podOrigin(pod);
  const x = o.x + rx;
  const y = o.y + ry;
  const w = lead ? LEAD_DESK_W : DESK_W;
  const h = lead ? LEAD_DESK_H : DESK_H;
  return {
    pod,
    index,
    desk: { x, y },
    w,
    h,
    seat: { x: x + (lead ? 18 : 14), y: y + 6 },
    monitor: { x: x + w - MONITOR_W - (lead ? 3 : 1), y: y + 3 - MONITOR_H },
    lead,
  };
}

const SUB_COLS = [8, 104, 200];
const SUB_ROWS = [76, 124];

/** Desk 0 is the lead's; 1..SUB_DESK_COUNT are staff desks. */
export function podDesks(pod: number): DeskSpot[] {
  return [
    spot(pod, 0, 100, 18, true),
    ...Array.from({ length: SUB_DESK_COUNT }, (_, i) =>
      spot(pod, i + 1, SUB_COLS[i % SUB_COLS.length]!, SUB_ROWS[Math.floor(i / SUB_COLS.length)]!),
    ),
  ];
}

/** Standing spots along the right wall for staff without a desk. */
export function standingSpot(roomW: number, i: number): Point {
  return { x: roomW - 16 - (i % 2) * 14, y: 110 + Math.floor(i / 2) * 22 };
}

/** Characters walk in the aisle above each row's chairs, then step down into the seat. */
const lane = (p: Point) => Math.max(DOOR.y, p.y - 22);

/** Walk path from the door: down the left aisle, across above the desk row, into the seat. */
export function pathFromDoor(to: Point): Point[] {
  return [DOOR, { x: DOOR.x, y: lane(to) }, { x: to.x, y: lane(to) }, to];
}

/** Moving between two spots inside the room (e.g. a reassigned desk). */
export function pathBetween(from: Point, to: Point): Point[] {
  return [{ x: from.x, y: lane(to) }, { x: to.x, y: lane(to) }, to];
}

export function pathToDoor(from: Point): Point[] {
  return [{ x: from.x, y: lane(from) }, { x: DOOR.x, y: lane(from) }, DOOR, DOOR_OUT];
}
