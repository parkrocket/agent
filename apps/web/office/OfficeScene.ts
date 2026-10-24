import { Application, Container, Text } from "pixi.js";
import { RoomView, type RoomInput } from "./RoomView";

export type SceneMode = "lobby" | "focus";

export interface SceneInput {
  /** Every room (kept alive so characters keep walking), in display order. */
  rooms: RoomInput[];
  /** Keys of the rooms to show: all lobby rooms, or just the focused one. */
  visible: string[];
  mode: SceneMode;
}

const GAP = 16;
const TITLE_H = 22;

/** All rooms in one Pixi app: a lobby grid, or one focused room filling the canvas. */
export class OfficeScene {
  private readonly roomLayer = new Container();
  private readonly ui = new Container();
  private readonly rooms = new Map<string, RoomView>();
  private readonly overlay: Text;
  private input: SceneInput = { rooms: [], visible: [], mode: "lobby" };
  private initialized = false;
  private detail = true;

  private constructor(
    private readonly app: Application,
    private readonly onOpenRoom: (key: string) => void,
  ) {
    app.stage.addChild(this.roomLayer, this.ui);
    this.overlay = new Text({
      text: "",
      style: { fontFamily: "ui-sans-serif, system-ui, 'Nanum Gothic', sans-serif", fontSize: 14, fill: 0xffffff },
      resolution: 2,
    });
    this.overlay.anchor.set(0.5);
    this.ui.addChild(this.overlay);
    app.renderer.on("resize", () => this.layout());
    app.ticker.add((t) => this.tick(t.deltaMS));
  }

  static async create(host: HTMLElement, onOpenRoom: (key: string) => void): Promise<OfficeScene> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: 0x0e1016,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: globalThis.devicePixelRatio ?? 1,
    });
    host.appendChild(app.canvas);
    return new OfficeScene(app, onOpenRoom);
  }

  sync(input: SceneInput) {
    this.input = input;
    const keys = new Set(input.rooms.map((r) => r.room.key));
    for (const [key, view] of this.rooms) {
      if (keys.has(key)) continue;
      view.destroy();
      this.rooms.delete(key);
    }
    for (const r of input.rooms) {
      let view = this.rooms.get(r.room.key);
      if (!view) {
        view = new RoomView(r.room.key, this.onOpenRoom);
        this.rooms.set(r.room.key, view);
        this.roomLayer.addChild(view.world);
        this.ui.addChild(view.ui);
      }
      // Everyone present on the first paint starts seated; anyone appearing later walks in.
      view.sync(r, !this.initialized);
    }
    this.initialized = true;
    this.overlay.text = input.rooms.length ? "" : "Claude Code 세션을 기다리는 중…";
    this.layout();
  }

  private layout() {
    const { width, height } = this.app.screen;
    this.overlay.position.set(width / 2, height / 2);
    const visible = this.input.visible.flatMap((k) => this.rooms.get(k) ?? []);
    for (const view of this.rooms.values()) view.visible = false;
    if (!visible.length) return;

    const lobby = this.input.mode === "lobby";
    const titleH = lobby ? TITLE_H : 0;
    const { cols, scale } = bestGrid(
      visible.map((v) => v.size),
      width,
      height,
      titleH,
    );
    // Lobby bubbles only make sense when rooms are drawn large enough to read.
    this.detail = !lobby || scale >= 1.5;

    const rows = Math.ceil(visible.length / cols);
    const cellW = (width - GAP * (cols + 1)) / cols;
    const cellH = (height - GAP * (rows + 1)) / rows;
    visible.forEach((view, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const w = view.size.w * scale;
      const h = view.size.h * scale + titleH;
      const x = GAP + col * (cellW + GAP) + (cellW - w) / 2;
      const y = GAP + row * (cellH + GAP) + (cellH - h) / 2 + titleH;
      view.visible = true;
      view.layout(x, y, scale, lobby, lobby);
    });
  }

  private tick(dtMs: number) {
    const now = Date.now();
    const frame = Math.floor(now / 250);
    for (const view of this.rooms.values()) view.tick(dtMs, now, frame, this.detail);
  }

  destroy() {
    this.app.destroy(true, { children: true });
  }
}

/**
 * Column count that lets every room be drawn largest, with one shared scale so
 * characters are the same size everywhere. Ties go to more columns (side by side).
 */
function bestGrid(sizes: { w: number; h: number }[], width: number, height: number, titleH: number) {
  let best = { cols: 1, scale: 0 };
  for (let cols = 1; cols <= sizes.length; cols++) {
    const rows = Math.ceil(sizes.length / cols);
    const cellW = (width - GAP * (cols + 1)) / cols;
    const cellH = (height - GAP * (rows + 1)) / rows - titleH;
    const scale = snapScale(Math.min(...sizes.map((s) => Math.min(cellW / s.w, cellH / s.h))));
    if (scale >= best.scale) best = { cols, scale };
  }
  return best;
}

/** Whole numbers from 2× up keep pixels square; quarter steps between 1× and 2× trade a little evenness for size. */
function snapScale(fit: number): number {
  if (fit >= 2) return Math.floor(fit);
  if (fit >= 1) return Math.floor(fit * 4) / 4;
  return Math.max(0.25, fit);
}
