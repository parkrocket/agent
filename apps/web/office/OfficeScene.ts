import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { loadAssets, type Assets } from "./assets";
import { RoomView, type RoomInput } from "./RoomView";
import { updateScreens } from "./screens";

export type SceneMode = "lobby" | "focus";

export interface SceneInput {
  /** Every room (kept alive so characters keep walking), in display order. */
  rooms: RoomInput[];
  /** Keys of the rooms to show: all lobby rooms, or just the focused one. */
  visible: string[];
  mode: SceneMode;
}

/** Gap between rooms in the lobby, in tiles. */
const GAP = 3;
/**
 * View direction (from target towards the camera): mostly south, a little east,
 * and up. Turning ~25° off a true 45° isometric makes rooms read wider than
 * tall, which suits a wide canvas and lets them be drawn larger.
 */
const VIEW_DIR = new THREE.Vector3(0.62, 1.25, 1.35).normalize();
/** Speech bubbles and name tags only appear once a tile is at least this many pixels tall. */
const DETAIL_PX_PER_TILE = 34;

/**
 * All rooms in one Three.js scene under a fixed isometric orthographic camera.
 * The lobby lays rooms out in a grid and frames them all; focus frames one
 * room. The camera eases between framings, so clicking a room flies into it.
 */
export class OfficeScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private readonly sun: THREE.DirectionalLight;
  private readonly rooms = new Map<string, RoomView>();
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

  /** Places visible rooms in a grid and sets the camera goal to frame them. */
  private layout() {
    const visible = this.input.visible.flatMap((k) => this.rooms.get(k) ?? []);
    const shown = new Set(visible);
    for (const view of this.rooms.values()) view.group.visible = shown.has(view);
    if (!visible.length) return;

    const aspect = this.aspect();
    let best: { cols: number; height: number; centre: THREE.Vector3 } | undefined;
    for (let cols = 1; cols <= visible.length; cols++) {
      this.arrange(visible, cols);
      const fit = this.frameFor(visible, aspect);
      if (!best || fit.height < best.height - 1e-6) best = { cols, ...fit };
    }
    this.arrange(visible, best!.cols);
    this.goal.target.copy(best!.centre);
    this.goal.height = best!.height;
    if (this.snapNext) {
      this.view.target.copy(this.goal.target);
      this.view.height = this.goal.height;
      this.snapNext = false;
    }
  }

  private arrange(visible: RoomView[], cols: number) {
    let z = 0;
    for (let row = 0; row * cols < visible.length; row++) {
      const rowRooms = visible.slice(row * cols, row * cols + cols);
      let x = 0;
      for (const v of rowRooms) {
        v.group.position.set(x, 0, z);
        x += v.size.w + GAP;
      }
      z += Math.max(...rowRooms.map((v) => v.size.d)) + GAP;
    }
  }

  /** World height the camera must show to fit these rooms, and the point to look at. */
  private frameFor(visible: RoomView[], aspect: number) {
    const cam = this.camera.clone();
    cam.position.copy(VIEW_DIR).multiplyScalar(100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const worldMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    const worldMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const p = new THREE.Vector3();
    for (const v of visible) {
      const o = v.group.position;
      for (const [x, y, z] of [
        [0, -0.4, 0],
        [v.size.w, -0.4, 0],
        [0, -0.4, v.size.d],
        [v.size.w, -0.4, v.size.d],
        [0, 1.7, 0],
        [v.size.w, 1.7, 0],
        [0, 1.7, v.size.d],
      ] as const) {
        p.set(o.x + x, y, o.z + z);
        worldMin.min(p);
        worldMax.max(p);
        min.min(p.clone().applyMatrix4(inv));
        max.max(p.clone().applyMatrix4(inv));
      }
    }
    const w = max.x - min.x;
    const h = max.y - min.y;
    // The centre of the projected box, mapped back to the ground plane along the view direction.
    const mid = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2).applyMatrix4(cam.matrixWorld);
    const t = mid.y / VIEW_DIR.y;
    const centre = mid.sub(VIEW_DIR.clone().multiplyScalar(t));
    return { height: Math.max(h, w / aspect) * 1.08 + 0.6, centre };
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
    const detail = this.input.mode === "focus" || pxPerTile >= DETAIL_PX_PER_TILE;
    const wall = Date.now();
    updateScreens(wall);
    for (const view of this.rooms.values()) view.tick(dt, wall, detail, view.group.visible);

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private onClick = (e: MouseEvent) => {
    if (this.input.mode !== "lobby") return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.rooms.values()].filter((v) => v.group.visible).flatMap((v) => v.pickables);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const key = hit?.object.userData.roomKey as string | undefined;
    if (key) this.onOpenRoom(key);
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
