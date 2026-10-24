// Room layout in base (unscaled) pixels. A "seat" is where a seated
// character's feet go: just behind the desk's top edge, so the desk hides
// the legs and the hands rest on the desk.
import { SUB_DESK_COUNT } from "@ai-office/shared";
import { DESK_H, DESK_W, LEAD_DESK_H, LEAD_DESK_W, MONITOR_H, MONITOR_W, WALL_H } from "./sprites";

export interface Point {
  x: number;
  y: number;
}

export interface DeskSpot {
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

/** Just inside the door. */
export const DOOR: Point = { x: 26, y: WALL_H + 4 };
/** Outside the door; walking here makes a character disappear through it. */
export const DOOR_OUT: Point = { x: 26, y: WALL_H - 2 };

function spot(index: number, x: number, y: number, lead = false): DeskSpot {
  const w = lead ? LEAD_DESK_W : DESK_W;
  const h = lead ? LEAD_DESK_H : DESK_H;
  return {
    index,
    desk: { x, y },
    w,
    h,
    seat: { x: x + (lead ? 18 : 14), y: y + 6 },
    monitor: { x: x + w - MONITOR_W - (lead ? 3 : 1), y: y + 3 - MONITOR_H },
    lead,
  };
}

export const LEAD_DESK = spot(0, 152, 60, true);

const COLS = [60, 156, 252];
const ROWS = [118, 166];

export const SUB_DESKS: DeskSpot[] = Array.from({ length: SUB_DESK_COUNT }, (_, i) =>
  spot(i + 1, COLS[i % COLS.length]!, ROWS[Math.floor(i / COLS.length)]!),
);

export function deskSpot(desk: number): DeskSpot | undefined {
  return desk === 0 ? LEAD_DESK : SUB_DESKS[desk - 1];
}

/** Standing spots along the right wall for staff without a desk. */
export function standingSpot(i: number): Point {
  return { x: 336 - (i % 2) * 14, y: 110 + Math.floor(i / 2) * 22 };
}

/** Characters walk in the aisle above each row's chairs, then step down into the seat. */
const lane = (p: Point) => Math.max(DOOR.y, p.y - 22);

/** Walk path from the door: down the left aisle, across behind the desk row, into the seat. */
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
