import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { ModelConfig, RoomActivity, RoomState, SessionMap, UsageSnapshot } from "@ai-office/shared";
import { contextGauge } from "@/lib/usage";
import { Agent, type Detail } from "./Agent";
import { CHARACTERS, cloneFurniture, type Assets, type CharacterName, type FurnitureName } from "./assets";
import {
  DOOR_GAP,
  podDesks,
  podOrigin,
  roomSize,
  standingSpot,
  type DeskSpot,
  type Point,
  type RoomPlacement,
} from "./layout";
import { SCREEN_MODE, screenMaterial } from "./screens";
import { visualStatus } from "./status";

export interface RoomInput {
  room: RoomState;
  sessions: SessionMap;
  label: string;
  activity: RoomActivity;
  /** Token usage for the context gauges (optional: drawn without gauges when absent). */
  usage?: UsageSnapshot;
  models?: ModelConfig;
}

/**
 * Extra rotation per model so that, after it, every model "faces" +z (its
 * front, a chair's seat opening, a screen's display) in its own frame.
 */
const FACING: Partial<Record<FurnitureName, number>> = {
  desk: 0,
  chairDesk: Math.PI,
  computerScreen: 0,
  computerKeyboard: 0,
  computerMouse: 0,
  bookcaseOpen: 0,
};

const LEAD_LOOK: CharacterName = "male-e";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Staff look varies by agent id, never the lead's outfit. */
function staffLook(id: string): CharacterName {
  const pool = CHARACTERS.filter((c) => c !== LEAD_LOOK);
  return pool[hash(id) % pool.length]!;
}

const deskKey = (pod: number, desk: number) => `${pod}:${desk}`;

let floorTexture: THREE.CanvasTexture | undefined;

/** Warm wooden planks, drawn once and tiled per room. */
function planks(): THREE.CanvasTexture {
  if (floorTexture) return floorTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const tones = ["#c99c6b", "#c3955f", "#cfa474", "#bf8f5c"];
  for (let row = 0; row < 4; row++) {
    for (let x = -64 + (row % 2) * 40; x < 128; x += 64) {
      ctx.fillStyle = tones[(row * 3 + Math.floor(x / 64) + 4) % tones.length]!;
      ctx.fillRect(x, row * 32, 64, 32);
      ctx.fillStyle = "rgba(90,55,25,0.35)";
      ctx.fillRect(x, row * 32, 1, 32);
    }
    ctx.fillStyle = "rgba(90,55,25,0.45)";
    ctx.fillRect(0, row * 32 + 31, 128, 1);
  }
  floorTexture = new THREE.CanvasTexture(c);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.anisotropy = 4;
  return floorTexture;
}

interface DeskView {
  spot: DeskSpot;
  screen: THREE.Mesh;
}

const STUB_H = 0.22;
const STUB_T = 0.08;

/** One project room in the building: low walls, a pod per session, and its characters. */
export class RoomView {
  readonly group = new THREE.Group();
  size = roomSize(1);
  /** Floor/base meshes used for click picking. */
  readonly pickables: THREE.Object3D[] = [];

  private readonly structure = new THREE.Group();
  /** Room-local material copies (furniture shares geometry, but each room can dim its own lights). */
  private readonly materials = new Map<THREE.Material, THREE.Material>();
  private readonly originalColors = new Map<THREE.Material, THREE.Color>();
  private readonly desks = new Map<string, DeskView>();
  private readonly agents = new Map<string, Agent>();
  private readonly leaving = new Set<Agent>();
  private readonly title: CSS2DObject;
  private readonly emptyLabel: CSS2DObject;
  /** Stable building order: rooms keep their place as others come and go. */
  order = 0;
  private podCount = -1;
  private rowEnd = false;
  /** Elevator-to-door route in room-local coordinates. */
  private entry: Point[] = [];
  private activity: RoomActivity = "empty";
  private dimmed = false;

  constructor(
    readonly key: string,
    private readonly assets: Assets,
  ) {
    this.group.add(this.structure);
    const title = document.createElement("div");
    title.className = "o3-room-title";
    this.title = new CSS2DObject(title);
    this.title.center.set(0, 1);
    this.group.add(this.title);

    const empty = document.createElement("div");
    empty.className = "o3-empty";
    empty.textContent = "비움 · 모두 퇴근";
    this.emptyLabel = new CSS2DObject(empty);
    this.group.add(this.emptyLabel);
  }

  private place(name: FurnitureName, parent: THREE.Object3D, x: number, y: number, z: number, yaw = 0) {
    const o = cloneFurniture(this.assets, name, this.materials);
    o.position.set(x, y, z);
    o.rotation.y = yaw + (FACING[name] ?? 0);
    parent.add(o);
    return o;
  }

  /** Where the building put this room, and the route from the elevator to its door (world coordinates). */
  setPlacement(p: RoomPlacement, entryWorld: Point[]) {
    this.group.position.set(p.x, 0, p.z);
    this.entry = entryWorld.map((q) => ({ x: q.x - p.x, z: q.z - p.z }));
    for (const a of this.agents.values()) a.entry = this.entry;
    if (p.rowEnd !== this.rowEnd) {
      this.rowEnd = p.rowEnd;
      this.rebuild(Math.max(1, this.podCount));
    }
  }

  /** Reconciles characters with the room's present sessions. `firstPaint` seats everyone without walking in. */
  sync({ room, sessions, label, activity, usage, models }: RoomInput, firstPaint: boolean) {
    this.activity = activity;
    this.order = room.firstSeenAt;
    const titleEl = this.title.element;
    titleEl.textContent = `${activity === "waiting" ? "! " : ""}${label}`;
    titleEl.className = `o3-room-title o3-room-${activity}`;

    const pods = Math.max(1, room.pods.length);
    if (pods !== this.podCount) this.rebuild(pods);

    const multi = room.pods.length > 1;
    const wanted = new Set<string>();
    let standing = 0;
    room.pods.forEach((sessionId, pod) => {
      const session = sessionId ? sessions[sessionId] : undefined;
      if (!session || session.offDuty) return;
      const desks = podDesks(pod);
      for (const agent of Object.values(session.agents)) {
        const key = `${session.sessionId}:${agent.key}`;
        wanted.add(key);
        const spot = agent.desk >= 0 ? desks[agent.desk] : undefined;
        const home = spot ? spot.seat : standingSpot(this.size.w, standing++);
        const gauge = usage ? contextGauge(usage, models, session.sessionId, agent) : undefined;
        const existing = this.agents.get(key);
        if (existing) {
          existing.gauge = gauge;
          existing.agent = agent;
          existing.deskKey = spot ? deskKey(pod, agent.desk) : undefined;
          existing.moveHome(home, spot?.yaw);
          continue;
        }
        const lead = agent.kind === "main";
        const name = lead ? (multi ? `팀장 ${session.sessionId.slice(0, 4)}` : "팀장") : (agent.type ?? "직원");
        const look = lead ? LEAD_LOOK : staffLook(agent.key);
        const a = new Agent(this.assets, agent, look, home, spot?.yaw, !firstPaint, name, this.entry);
        a.deskKey = spot ? deskKey(pod, agent.desk) : undefined;
        a.gauge = gauge;
        this.group.add(a.root);
        this.agents.set(key, a);
      }
    });
    for (const [key, a] of this.agents) {
      if (wanted.has(key)) continue;
      a.leave();
      this.agents.delete(key);
      this.leaving.add(a);
    }
  }

  private rebuild(pods: number) {
    this.podCount = pods;
    this.size = roomSize(pods);
    const { w, d } = this.size;
    for (const child of [...this.structure.children]) child.removeFromParent();
    this.desks.clear();
    this.pickables.length = 0;

    // wooden floor (the building provides the slab and the corridor floor around it)
    const map = planks().clone();
    map.repeat.set(w / 2, d / 2);
    map.needsUpdate = true;
    const floorMat = this.own(new THREE.MeshStandardMaterial({ map, roughness: 0.85 }));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), floorMat);
    floor.position.set(w / 2, 0.006, d / 2);
    floor.receiveShadow = true;
    this.structure.add(floor);
    this.pickables.push(floor);
    floor.userData.roomKey = this.key;

    // low walls ("walls down"): north with the door gap, west, south; east only at the end of a row
    const stubMat = this.own(new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.8 }));
    const stub = (x0: number, z0: number, x1: number, z1: number) => {
      const along = x1 - x0 > z1 - z0;
      const len = along ? x1 - x0 : z1 - z0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(along ? len : STUB_T, STUB_H, along ? STUB_T : len), stubMat);
      m.position.set((x0 + x1) / 2, STUB_H / 2, (z0 + z1) / 2);
      m.castShadow = m.receiveShadow = true;
      this.structure.add(m);
    };
    stub(0, 0, DOOR_GAP[0], 0);
    stub(DOOR_GAP[1], 0, w, 0);
    stub(0, 0, 0, d);
    stub(0, d, w, d);
    if (this.rowEnd) stub(w, 0, w, d);

    // decoration along the east side and corners
    this.place("bookcaseOpen", this.structure, w - 0.8, 0, 0.2);
    this.place("bookcaseOpen", this.structure, w - 1.3, 0, 0.2);
    this.place("pottedPlant", this.structure, w - 0.35, 0, 0.35);
    this.place("sideTable", this.structure, w - 0.4, 0, 1.9, -Math.PI / 2);
    this.place("kitchenCoffeeMachine", this.structure, w - 0.4, this.assets.size.sideTable.y, 1.9, -Math.PI / 2);
    this.place("pottedPlant", this.structure, w - 0.4, 0, d - 0.4);
    this.place("pottedPlant", this.structure, 0.45, 0, d - 0.4);
    this.place("coatRackStanding", this.structure, 0.35, 0, 2.6);
    this.place("trashcan", this.structure, 0.35, 0, 3.3);

    for (let pod = 0; pod < pods; pod++) {
      const o = podOrigin(pod);
      this.place("rugRectangle", this.structure, o.x + 2.2, 0.004, o.z + 0.65);
      this.place("plantSmall1", this.structure, o.x + 3.3, 0, o.z + 0.3);
      this.place("lampRoundFloor", this.structure, o.x + 1.1, 0, o.z + 0.3);
      for (const spot of podDesks(pod)) this.addDesk(spot);
    }

    this.title.position.set(0.15, 0.35, 0.1);
    this.emptyLabel.position.set(w / 2, 0.8, d / 2);
    if (this.dimmed) this.applyDim(true);
  }

  /** Registers a room-owned material so dimming reaches it too. */
  private own<T extends THREE.Material>(m: T): T {
    this.materials.set(m, m);
    return m;
  }

  private addDesk(spot: DeskSpot) {
    const unit = new THREE.Group();
    unit.position.set(spot.desk.x, 0, spot.desk.z);
    unit.rotation.y = spot.yaw;
    const deskH = this.assets.size.desk.y;
    this.place("desk", unit, 0, 0, 0);
    this.place("chairDesk", unit, 0, 0, 0.62);
    // The lead faces the camera, so their monitor goes to one side, angled in, to keep the face visible.
    const monitor = spot.lead
      ? this.place("computerScreen", unit, 0.2, deskH, -0.06, 0.45)
      : this.place("computerScreen", unit, 0, deskH, -0.08);
    this.place("computerKeyboard", unit, -0.02, deskH, 0.1);
    this.place("computerMouse", unit, 0.22, deskH, 0.1);

    // glowing screen on the monitor's display face (a child, so it follows the monitor)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), screenMaterial("off"));
    screen.position.set(0, 0.165, this.assets.size.computerScreen.z / 2 + 0.004);
    monitor.add(screen);

    this.structure.add(unit);
    this.desks.set(deskKey(spot.pod, spot.index), { spot, screen });
  }

  /** World positions of everyone in or leaving this room (for the elevator doors). */
  walkers(): Point[] {
    const o = this.group.position;
    return [...this.agents.values(), ...this.leaving].map((a) => ({ x: a.root.position.x + o.x, z: a.root.position.z + o.z }));
  }

  private applyDim(on: boolean) {
    for (const m of this.materials.values()) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat.color) continue;
      if (!this.originalColors.has(mat)) this.originalColors.set(mat, mat.color.clone());
      mat.color.copy(this.originalColors.get(mat)!);
      if (on) mat.color.multiplyScalar(0.32);
    }
  }

  tick(dtMs: number, now: number, detail: Detail, shown: boolean) {
    const empty = this.activity === "empty" && this.agents.size === 0 && this.leaving.size === 0;
    if (empty !== this.dimmed) {
      this.dimmed = empty;
      this.applyDim(empty);
    }
    this.emptyLabel.visible = shown && empty;
    this.title.visible = shown;

    const occupied = new Map<string, Agent>();
    for (const a of this.agents.values()) if (a.deskKey) occupied.set(a.deskKey, a);
    for (const [key, desk] of this.desks) {
      const a = occupied.get(key);
      desk.screen.material = screenMaterial(a ? SCREEN_MODE[visualStatus(a.agent, now)] : "off");
    }
    for (const a of this.agents.values()) a.update(dtMs, now, detail, shown);
    for (const a of this.leaving) {
      a.update(dtMs, now, detail, shown);
      if (a.done) {
        a.dispose();
        this.leaving.delete(a);
      }
    }
  }

  dispose() {
    for (const a of [...this.agents.values(), ...this.leaving]) a.dispose();
    this.group.removeFromParent();
    for (const m of this.materials.values()) m.dispose();
  }
}
