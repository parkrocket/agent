// Room layout in floor tiles (1 unit = 1 tile), relative to the room's
// north-west corner: x grows east, z grows south (towards the camera).
// The room has walls on the north and west sides only (a cut-away diorama).
// Each session gets a pod: the lead's desk at the back facing south, and
// staff desks in two rows facing north towards the lead, so the camera sees
// staff monitors and the lead's face.
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

/** The door is in the west wall near the back; DOOR_OUT is just outside it. */
export const DOOR: Point = { x: 0.6, z: 1.5 };
export const DOOR_OUT: Point = { x: -0.6, z: 1.5 };
export const DOOR_TILE_Z = 1;

/** Walkers use the aisle behind (lead) or in front of (staff) each row of chairs. */
function lane(p: Point, lead: boolean): number {
  return lead ? p.z - 0.5 : p.z + 0.5;
}

export function pathFromDoor(to: Point, lead: boolean): Point[] {
  const z = lane(to, lead);
  return [DOOR, { x: 1, z: DOOR.z }, { x: 1, z }, { x: to.x, z }, to];
}

export function pathBetween(from: Point, to: Point, lead: boolean): Point[] {
  const z = lane(to, lead);
  return [{ x: from.x, z }, { x: to.x, z }, to];
}

export function pathToDoor(from: Point, lead: boolean): Point[] {
  const z = lane(from, lead);
  return [{ x: from.x, z }, { x: 1, z }, { x: 1, z: DOOR.z }, DOOR, DOOR_OUT];
}
