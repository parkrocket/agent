import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { loadAssets, type Assets } from "./assets";
import { Building } from "./Building";
import { buildingLayout, entryPath } from "./layout";
import type { Detail } from "./Agent";
import { RoomView, type RoomInput } from "./RoomView";
import { updateScreens } from "./screens";

export type SceneMode = "lobby" | "focus";

export interface SceneInput {
  /** Every room; all of them are drawn in the building. */
  rooms: RoomInput[];
  /** Focus mode: the one room to frame (the lobby frames the whole building). */
  visible: string[];
  mode: SceneMode;
}
/**
 * View direction (from target towards the camera): mostly south, a little east,
 * and up. Turning ~25° off a true 45° isometric makes rooms read wider than
 * tall, which suits a wide canvas and lets them be drawn larger.
 */
const VIEW_DIR = new THREE.Vector3(0.62, 1.25, 1.35).normalize();
/** On the whole-floor view, leads' bubbles and names appear once a tile is at least this many pixels tall. */
const DETAIL_PX_PER_TILE = 22;

/**
 * The whole office as one building under a fixed isometric orthographic
 * camera. Every room is always drawn in place; the lobby frames the whole
 * floor and focus frames one room, with the camera easing between them, so
 * clicking a room zooms into it with its neighbours still around it.
 */
export class OfficeScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private readonly sun: THREE.DirectionalLight;
  private readonly rooms = new Map<string, RoomView>();
  private readonly building: Building;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private input: SceneInput = { rooms: [], visible: [], mode: "lobby" };
  private initialized = false;
  /** Current and desired framing: look-at point and visible world height. */
  private view = { target: new THREE.Vector3(), height: 20 };
  private goal = { target: new THREE.Vector3(), height: 20 };
  private snapNext = true;
  private last = performance.now();
  private readonly overlay: HTMLDivElement;

  private constructor(
    private readonly host: HTMLElement,
    private readonly assets: Assets,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly labels: CSS2DRenderer,
    private readonly onOpenRoom: (key: string) => void,
  ) {
    this.building = new Building(assets);
    this.scene.add(this.building.group);
    this.scene.add(new THREE.HemisphereLight(0xfff1dd, 0x39405a, 1.6));
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    // a cool rim from the other side keeps shadowed faces from going flat
    const fill = new THREE.DirectionalLight(0x9fb7ff, 0.45);
    fill.position.set(10, 6, -8);
    this.scene.add(fill);

    this.overlay = document.createElement("div");
    this.overlay.className = "o3-overlay";
    host.appendChild(this.overlay);

    renderer.domElement.addEventListener("click", this.onClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    renderer.setAnimationLoop(() => this.frame());
  }

  static async create(host: HTMLElement, onOpenRoom: (key: string) => void): Promise<OfficeScene> {
    // Transparent, so the container's CSS gradient shows behind the diorama.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio ?? 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.domElement.className = "o3-labels";
    host.appendChild(labels.domElement);

    const loading = document.createElement("div");
    loading.className = "o3-overlay";
    loading.textContent = "사무실을 짓는 중…";
    host.appendChild(loading);
    try {
      const assets = await loadAssets();
      return new OfficeScene(host, assets, renderer, labels, onOpenRoom);
    } finally {
      loading.remove();
    }
  }

  sync(input: SceneInput) {
    this.input = input;
    const keys = new Set(input.rooms.map((r) => r.room.key));
    for (const [key, view] of this.rooms) {
      if (keys.has(key)) continue;
      view.dispose();
      this.rooms.delete(key);
    }
    for (const r of input.rooms) {
      let view = this.rooms.get(r.room.key);
      if (!view) {
        view = new RoomView(r.room.key, this.assets);
        this.rooms.set(r.room.key, view);
        this.scene.add(view.group);
      }
      // Everyone present on the first paint starts seated; anyone appearing later walks in.
      view.sync(r, !this.initialized);
    }
    if (!this.initialized) this.snapNext = true;
    this.initialized = true;
    this.overlay.textContent = input.rooms.length ? "" : "Claude Code 세션을 기다리는 중…";
    this.layout();
  }

  /** Places rooms in the building (stable order) and sets the camera goal. */
  private layout() {
    const ordered = [...this.rooms.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    const b = buildingLayout(ordered.map((v) => ({ key: v.key, w: v.size.w, d: v.size.d })));
    this.building.update(b);
    for (const v of ordered) v.setPlacement(b.rooms.get(v.key)!, entryPath(b, v.key));

    const focus = this.input.mode === "focus" ? this.rooms.get(this.input.visible[0] ?? "") : undefined;
    const box = focus
      ? { x0: focus.group.position.x, z0: focus.group.position.z - 0.6, x1: focus.group.position.x + focus.size.w, z1: focus.group.position.z + focus.size.d, h: 1 }
      : { x0: 0, z0: 0, x1: b.w, z1: b.d, h: 1.4 };
    const fit = this.frameFor(box, this.aspect());
    this.goal.target.copy(fit.centre);
    this.goal.height = fit.height;
    if (this.snapNext) {
      this.view.target.copy(this.goal.target);
      this.view.height = this.goal.height;
      this.snapNext = false;
    }
  }

  /** World height the camera must show to fit a box (floor rectangle + height), and the point to look at. */
  private frameFor(box: { x0: number; z0: number; x1: number; z1: number; h: number }, aspect: number) {
    const cam = this.camera.clone();
    cam.position.copy(VIEW_DIR).multiplyScalar(100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const x of [box.x0, box.x1])
      for (const z of [box.z0, box.z1])
        for (const y of [-0.5, box.h]) {
          p.set(x, y, z).applyMatrix4(inv);
          min.min(p);
          max.max(p);
        }
    const w = max.x - min.x;
    const h = max.y - min.y;
    // The centre of the projected box, mapped back to the ground plane along the view direction.
    const mid = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2).applyMatrix4(cam.matrixWorld);
    const t = mid.y / VIEW_DIR.y;
    const centre = mid.sub(VIEW_DIR.clone().multiplyScalar(t));
    return { height: Math.max(h, w / aspect) * 1.06 + 0.4, centre };
  }

  private aspect() {
    const { clientWidth: w, clientHeight: h } = this.host;
    return h > 0 ? w / h : 1;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.layout();
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;

    // ease the camera towards its goal
    const k = 1 - Math.exp(-dt / 160);
    this.view.target.lerp(this.goal.target, k);
    this.view.height += (this.goal.height - this.view.height) * k;
    const aspect = this.aspect();
    const half = this.view.height / 2;
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.position.copy(this.view.target).addScaledVector(VIEW_DIR, 60);
    this.camera.lookAt(this.view.target);
    this.camera.updateProjectionMatrix();

    // the sun follows the view so its shadow map covers what's on screen
    const span = this.view.height * Math.max(1, aspect) * 0.75;
    this.sun.position.copy(this.view.target).add(new THREE.Vector3(-7, 14, 9));
    this.sun.target.position.copy(this.view.target);
    const sc = this.sun.shadow.camera;
    Object.assign(sc, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 60 });
    sc.updateProjectionMatrix();

    const pxPerTile = this.host.clientHeight / this.view.height;
    const detail: Detail =
      this.input.mode === "focus" ? "full" : pxPerTile >= DETAIL_PX_PER_TILE ? "summary" : "none";
    const wall = Date.now();
    updateScreens(wall);
    for (const view of this.rooms.values()) view.tick(dt, wall, detail, true);
    this.building.tick(dt, [...this.rooms.values()].flatMap((v) => v.walkers()));

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private onClick = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.rooms.values()].flatMap((v) => v.pickables);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const key = hit?.object.userData.roomKey as string | undefined;
    // a room zooms in; anywhere else while zoomed in goes back to the whole floor
    if (key) this.onOpenRoom(key);
    else if (this.input.mode === "focus") this.onOpenRoom("lobby");
  };

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("click", this.onClick);
    for (const view of this.rooms.values()) view.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
    this.overlay.remove();
  }
}
