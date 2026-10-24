import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { cloneFurniture, type Assets, type FurnitureName } from "./assets";
import { DOOR_GAP, ELEVATOR, ELEVATOR_FRONT, WING_W, type BuildingLayout, type Point, type Rect } from "./layout";

/** Extra rotation per model so its front faces +z (see RoomView's FACING). */
const FACING: Partial<Record<FurnitureName, number>> = {
  chairDesk: Math.PI,
  loungeSofa: 0,
  loungeChair: 0,
  chair: 0,
  bench: 0,
  kitchenCabinet: 0,
  kitchenSink: 0,
  kitchenFridgeSmall: 0,
  televisionModern: 0,
};

const STUB_H = 0.22;
const STUB_T = 0.08;
const ELEVATOR_W = 1.3;
const ELEVATOR_H = 1.25;

let tileTexture: THREE.CanvasTexture | undefined;

/** Pale stone tiles for the lobby and corridors. */
function tiles(): THREE.CanvasTexture {
  if (tileTexture) return tileTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d9d6cf";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#cfcbc2";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  ctx.fillStyle = "rgba(120,110,95,0.35)";
  ctx.fillRect(0, 0, 64, 1);
  ctx.fillRect(0, 32, 64, 1);
  ctx.fillRect(0, 0, 1, 64);
  ctx.fillRect(32, 0, 1, 64);
  tileTexture = new THREE.CanvasTexture(c);
  tileTexture.colorSpace = THREE.SRGBColorSpace;
  tileTexture.wrapS = tileTexture.wrapT = THREE.RepeatWrapping;
  tileTexture.anisotropy = 4;
  return tileTexture;
}

/**
 * The building shell and the shared wing: slab, lobby/corridor floor, outer
 * north and west walls with windows, the elevator (whose doors open when
 * someone is near), reception, lounge with a kitchenette, and a meeting room.
 */
export class Building {
  readonly group = new THREE.Group();
  private readonly shell = new THREE.Group();
  private readonly materials = new Map<THREE.Material, THREE.Material>();
  private readonly doors: THREE.Mesh[] = [];
  private doorOpen = 0;
  private size = { w: 0, d: 0 };
  /** Geometry signature of the last build, to skip rebuilding when nothing changed. */
  private built = "";

  constructor(private readonly assets: Assets) {
    this.group.add(this.shell);
  }

  private place(name: FurnitureName, x: number, z: number, yaw = 0, y = 0, scale = 1) {
    const o = cloneFurniture(this.assets, name, this.materials);
    o.position.set(x, y, z);
    o.rotation.y = yaw + (FACING[name] ?? 0);
    o.scale.setScalar(scale);
    this.shell.add(o);
    return o;
  }

  private label(text: string, x: number, z: number) {
    const el = document.createElement("div");
    el.className = "o3-area";
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.set(x, 0.05, z);
    this.shell.add(o);
  }

  /** Rebuilds the shell when the building's footprint changes. */
  update(layout: BuildingLayout) {
    const signature = JSON.stringify([layout.w, layout.d, layout.vacant]);
    if (signature === this.built) return;
    this.built = signature;
    this.size = { w: layout.w, d: layout.d };
    for (const child of [...this.shell.children]) child.removeFromParent();
    this.doors.length = 0;
    const { w, d } = this.size;

    // slab and the shared floor (rooms lay their wooden floors on top)
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a3343, roughness: 0.9 }),
    );
    slab.position.set(w / 2, -0.25, d / 2);
    slab.receiveShadow = true;
    const map = tiles().clone();
    map.repeat.set(w / 2, d / 2);
    map.needsUpdate = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map, roughness: 0.6 }),
    );
    floor.position.set(w / 2, 0.002, d / 2);
    floor.receiveShadow = true;
    this.shell.add(slab, floor);

    // outer walls: north (windows, the elevator in the wing) and west (windows)
    const elevatorTiles = new Set([1, 2]);
    for (let i = 0; i < w; i++) {
      if (elevatorTiles.has(i)) continue;
      this.place(i % 2 === 1 && i > 3 ? "wallWindow" : "wall", i + 0.5, 0.03);
    }
    for (let j = 0; j < d; j++) this.place(j % 3 === 1 ? "wallWindow" : "wall", 0.03, j + 0.5, Math.PI / 2);
    this.buildElevator();

    this.buildWing();
    for (const v of layout.vacant) this.buildVacant(v);
  }

  /** An unlit, unfurnished office filling the end of a short row. */
  private buildVacant(r: Rect) {
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w, r.d).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x55596a, roughness: 0.95 }),
    );
    carpet.position.set(r.x + r.w / 2, 0.006, r.z + r.d / 2);
    carpet.receiveShadow = true;
    this.shell.add(carpet);
    this.stub(r.x, r.z, r.x + DOOR_GAP[0], r.z);
    this.stub(r.x + DOOR_GAP[1], r.z, r.x + r.w, r.z);
    this.stub(r.x, r.z + r.d, r.x + r.w, r.z + r.d);
    this.stub(r.x + r.w, r.z, r.x + r.w, r.z + r.d);
    this.place("cardboardBoxClosed", r.x + r.w - 0.8, r.z + 0.6);
    this.place("cardboardBoxOpen", r.x + r.w - 1.4, r.z + 0.7, 0.4);
    this.label("빈 사무실", r.x + r.w / 2, r.z + r.d / 2);
  }

  private stub(x0: number, z0: number, x1: number, z1: number) {
    const along = x1 - x0 > z1 - z0;
    const len = along ? x1 - x0 : z1 - z0;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(along ? len : STUB_T, STUB_H, along ? STUB_T : len),
      new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.8 }),
    );
    m.position.set((x0 + x1) / 2, STUB_H / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    this.shell.add(m);
  }

  private buildElevator() {
    const g = new THREE.Group();
    g.position.set(ELEVATOR.x, 0, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0x8b93a3, metalness: 0.6, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 });
    // back wall of the car and the frame around the opening
    const back = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_W + 0.7, 1.29, 0.06), new THREE.MeshStandardMaterial({ color: 0xd8d2c4 }));
    back.position.set(0, 0.645, 0.03);
    const car = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_W - 0.1, ELEVATOR_H - 0.05, 0.02), dark);
    car.position.set(0, (ELEVATOR_H - 0.05) / 2, 0.07);
    const top = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_W + 0.2, 0.12, 0.12), metal);
    top.position.set(0, ELEVATOR_H + 0.02, 0.36);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.1, ELEVATOR_H, 0.12), metal);
    sideL.position.set(-ELEVATOR_W / 2 - 0.05, ELEVATOR_H / 2, 0.36);
    const sideR = sideL.clone();
    sideR.position.x = ELEVATOR_W / 2 + 0.05;
    // floor indicator light
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.07, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false }),
    );
    light.position.set(0, ELEVATOR_H + 0.02, 0.425);
    g.add(back, car, top, sideL, sideR, light);
    // two sliding doors
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR_W / 2, ELEVATOR_H - 0.02, 0.04), metal);
      door.position.set((side * ELEVATOR_W) / 4, (ELEVATOR_H - 0.02) / 2, 0.34);
      door.userData.side = side;
      door.castShadow = true;
      g.add(door);
      this.doors.push(door);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
    this.shell.add(g);
  }

  private buildWing() {
    // reception: a desk facing the hall, its chair behind, a plant, and a visitors' bench
    const deskH = this.assets.size.desk.y;
    this.place("desk", 4.3, 2.75, Math.PI);
    this.place("desk", 3.57, 2.75, Math.PI);
    this.place("chairDesk", 3.95, 2.15, Math.PI);
    this.place("computerScreen", 4.3, 2.83, Math.PI, deskH);
    this.place("pottedPlant", 5.5, 2.4);
    this.place("bench", 1.2, 2.6, Math.PI / 2);
    this.place("bench", 1.2, 3.1, Math.PI / 2);
    this.label("로비", 3.9, 3.5);

    // lounge: sofa and armchairs around a coffee table, kitchenette along the west wall
    this.place("rugRound", 3.3, 6.1, 0, 0.004, 2.2);
    this.place("tableCoffee", 3.5, 6.0);
    this.place("loungeSofa", 3.3, 7.1, Math.PI);
    this.place("loungeChair", 2.1, 6.0, Math.PI / 2);
    this.place("loungeChair", 4.6, 6.0, -Math.PI / 2);
    this.place("kitchenCabinet", 0.32, 4.6, Math.PI / 2);
    this.place("kitchenSink", 0.32, 5.05, Math.PI / 2);
    this.place("kitchenCabinet", 0.32, 5.5, Math.PI / 2);
    this.place("kitchenCoffeeMachine", 0.32, 5.5, Math.PI / 2, this.assets.size.kitchenCabinet.y);
    this.place("kitchenFridgeSmall", 0.3, 6.05, Math.PI / 2);
    this.place("plantSmall2", 5.5, 4.4);
    this.label("라운지", 3.3, 4.6);

    // meeting room: low walls with a doorway to the walkway, a long table, chairs and a TV
    const z0 = 8.6;
    const z1 = 12.6;
    const x1 = 5.8;
    this.stub(0.05, z0, x1, z0);
    this.stub(0.05, z1, x1, z1);
    this.stub(x1, z0, x1, 10);
    this.stub(x1, 11, x1, z1);
    const tableW = this.assets.size.table.x;
    for (const i of [0, 1, 2]) this.place("table", 1.9 + i * tableW, 10.6);
    for (const i of [0, 1, 2]) {
      const x = 1.9 + i * tableW;
      this.place("chair", x, 10.05);
      this.place("chair", x, 11.15, Math.PI);
    }
    this.place("televisionModern", 0.35, 10.6, Math.PI / 2);
    this.place("pottedPlant", 5.4, 9.0);
    this.label("회의실", 3.0, 9.0);

    // a plant by the walkway and the hall
    this.place("pottedPlant", WING_W - 0.3, 0.4);
  }

  /** Opens the elevator doors while anyone is near them. */
  tick(dtMs: number, walkers: Point[]) {
    const near = walkers.some(
      (p) =>
        Math.hypot(p.x - ELEVATOR_FRONT.x, p.z - ELEVATOR_FRONT.z) < 1.3 ||
        (Math.abs(p.x - ELEVATOR.x) < ELEVATOR_W / 2 && p.z < 0.6),
    );
    const target = near ? 1 : 0;
    this.doorOpen += (target - this.doorOpen) * (1 - Math.exp(-dtMs / 120));
    // each door slides into its side pocket: it narrows towards the frame instead of passing it
    const shut = Math.max(0.02, 1 - this.doorOpen);
    for (const door of this.doors) {
      const side = door.userData.side as number;
      door.scale.x = shut;
      door.position.x = side * (ELEVATOR_W / 2 - (ELEVATOR_W / 4) * shut);
    }
  }

  /** Building footprint for camera framing. */
  get bounds() {
    return this.size;
  }
}
