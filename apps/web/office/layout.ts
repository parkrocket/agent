// Layout in floor tiles (1 unit = 1 tile): x grows east, z grows south
// (towards the camera).
//
// The office is one building floor. A common wing on the west holds the
// elevator, reception, lounge and meeting room; project rooms sit in rows
// to its east, each row with a corridor along its north side. Interior
// walls are drawn low ("walls down") so the camera sees into every room and
// corridor; only the building's outer north and west walls are full height.
//
// Inside a room (coordinates relative to its north-west corner) each session
// gets a pod: the lead's desk at the back facing south, and staff desks in
// two rows facing north towards the lead, so the camera sees staff monitors
// and the lead's face. Rooms are entered through a gap in the north wall.
import { SUB_DESK_COUNT } from "@ai-office/shared";

export interface Point {
  x: number;
  z: number;
}

export interface DeskSpot {
  pod: number;
  index: number;
  lead: boolean;
  /** Desk centre. */
  desk: Point;
  /** Where the seated character is placed. */
  seat: Point;
  /**
   * Rotation (radians around y) of the desk unit. In the unit's own frame the
   * sitter is on the +z side facing -z; staff use 0 (sitter south, facing
   * north), the lead uses π (sitter north, facing south).
   */
  yaw: number;
}

export const POD_W = 4.4;
export const POD_D = 4.8;
export const PODS_PER_ROW = 2;
const LEFT = 1.3; // door aisle
const RIGHT = 1.3; // bookcase, coffee corner, standing spots
const BACK = 0.7;
const FRONT = 0.4;

/**
 * Room footprint for a number of pods; an empty room is drawn at one-pod size.
 * Rounded up to whole tiles so wall segments (1 tile each) line up with the floor.
 */
export function roomSize(pods: number): { w: number; d: number } {
  const n = Math.max(1, pods);
  const cols = Math.min(PODS_PER_ROW, n);
  const rows = Math.ceil(n / PODS_PER_ROW);
  return { w: Math.ceil(LEFT + cols * POD_W + RIGHT), d: Math.ceil(BACK + rows * POD_D + FRONT) };
}

export function podOrigin(pod: number): Point {
  return { x: LEFT + (pod % PODS_PER_ROW) * POD_W, z: BACK + Math.floor(pod / PODS_PER_ROW) * POD_D };
}

/** Distance from a desk's centre to its chair. */
const SEAT_OFFSET = 0.62;
const STAFF_COLS = [0.9, 2.2, 3.5];
const STAFF_ROWS = [2.1, 3.6];

function spot(pod: number, index: number, rx: number, rz: number, lead: boolean): DeskSpot {
  const o = podOrigin(pod);
  const desk = { x: o.x + rx, z: o.z + rz };
  // The lead sits north of the desk facing south; staff sit south of theirs facing north.
  const seat = { x: desk.x, z: desk.z + (lead ? -SEAT_OFFSET : SEAT_OFFSET) };
  return { pod, index, lead, desk, seat, yaw: lead ? Math.PI : 0 };
}

/** Desk 0 is the lead's; 1..SUB_DESK_COUNT are staff desks. */
export function podDesks(pod: number): DeskSpot[] {
  return [
    spot(pod, 0, 2.2, 0.9, true),
    ...Array.from({ length: SUB_DESK_COUNT }, (_, i) =>
      spot(pod, i + 1, STAFF_COLS[i % STAFF_COLS.length]!, STAFF_ROWS[Math.floor(i / STAFF_COLS.length)]!, false),
    ),
  ];
}

/** Standing spots along the east side for staff without a desk. */
export function standingSpot(roomW: number, i: number): Point {
  return { x: roomW - 1.1 + (i % 2) * 0.5, z: 3 + Math.floor(i / 2) * 0.6 };
}

/** Room door: a gap in the north wall at x 0.5..1.5, in line with the room's west aisle (x = 1). */
export const DOOR_GAP: [number, number] = [0.5, 1.5];
/** Just inside the door (room-local). */
export const DOOR: Point = { x: 1, z: 0.35 };
/** Just outside the door, in the corridor (room-local). */
export const DOOR_OUT: Point = { x: 1, z: -0.5 };

/** Walkers use the aisle behind (lead) or in front of (staff) each row of chairs. */
function lane(p: Point, lead: boolean): number {
  return lead ? p.z - 0.5 : p.z + 0.5;
}

/**
 * `entry` is the route from the elevator to just outside this room's door,
 * in room-local coordinates (see `entryPath`); empty when not yet placed.
 */
export function pathFromDoor(to: Point, lead: boolean, entry: Point[]): Point[] {
  const z = lane(to, lead);
  return [...entry, DOOR_OUT, DOOR, { x: DOOR.x, z }, { x: to.x, z }, to];
}

export function pathBetween(from: Point, to: Point, lead: boolean): Point[] {
  const z = lane(to, lead);
  return [{ x: from.x, z }, { x: to.x, z }, to];
}

export function pathToDoor(from: Point, lead: boolean, entry: Point[]): Point[] {
  const z = lane(from, lead);
  return [{ x: from.x, z }, { x: DOOR.x, z }, DOOR, DOOR_OUT, ...[...entry].reverse()];
}

// ------------------------------------------------------------------ building

export const WING_W = 7;
/** Free north-south walkway along the wing's east edge, next to the rooms. */
export const WALKWAY_X = 6.4;
export const CORRIDOR_D = 2;
export const ROOMS_PER_ROW = 3;
/** The wing needs this much depth for reception, lounge and meeting room. */
const WING_MIN_D = 13;
/** Inside the elevator car, and the hall spot in front of it (world). */
export const ELEVATOR: Point = { x: 1.9, z: 0.2 };
export const ELEVATOR_FRONT: Point = { x: 1.9, z: CORRIDOR_D / 2 };

export interface RoomPlacement {
  x: number;
  z: number;
  row: number;
  /** Last room in its row: draws its own east wall. */
  rowEnd: boolean;
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface BuildingLayout {
  w: number;
  d: number;
  rooms: Map<string, RoomPlacement>;
  /** Centre line (z) of each row's corridor. */
  corridors: { z: number }[];
  /** Unoccupied office space where a row is shorter than the widest one. */
  vacant: Rect[];
}

/**
 * Places rooms (in a stable order) into rows east of the wing. Rows are
 * balanced (4 rooms → 2 + 2, 5 → 3 + 2) and any leftover space at the end of
 * a short row becomes a vacant office, so the building stays rectangular.
 */
export function buildingLayout(rooms: { key: string; w: number; d: number }[]): BuildingLayout {
  const placed = new Map<string, RoomPlacement>();
  const corridors: BuildingLayout["corridors"] = [];
  const rowsOf: { z: number; d: number; x1: number }[] = [];
  const rowCount = Math.max(1, Math.ceil(rooms.length / ROOMS_PER_ROW));
  const perRow = Math.max(1, Math.ceil(rooms.length / rowCount));
  let z = 0;
  for (let row = 0; row < rowCount; row++) {
    const inRow = rooms.slice(row * perRow, (row + 1) * perRow);
    const rowZ = z + CORRIDOR_D;
    let x = WING_W;
    inRow.forEach((r, i) => {
      placed.set(r.key, { x, z: rowZ, row, rowEnd: i === inRow.length - 1 });
      x += r.w;
    });
    const d = Math.max(roomSize(1).d, ...inRow.map((r) => r.d));
    corridors.push({ z: z + CORRIDOR_D / 2 });
    rowsOf.push({ z: rowZ, d, x1: x });
    z = rowZ + d;
  }
  const w = Math.max(WING_W + roomSize(1).w, ...rowsOf.map((r) => r.x1));
  const vacant = rowsOf.filter((r) => r.x1 < w).map((r) => ({ x: r.x1, z: r.z, w: w - r.x1, d: r.d }));
  return { w, d: Math.max(z, WING_MIN_D), rooms: placed, corridors, vacant };
}

/** World route from inside the elevator to just outside a room's door. */
export function entryPath(b: BuildingLayout, key: string): Point[] {
  const r = b.rooms.get(key);
  if (!r) return [];
  const zc = b.corridors[r.row]!.z;
  return [ELEVATOR, ELEVATOR_FRONT, { x: WALKWAY_X, z: ELEVATOR_FRONT.z }, { x: WALKWAY_X, z: zc }, { x: r.x + DOOR_OUT.x, z: zc }];
}
