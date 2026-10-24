// All pixel art is drawn in code here (no external image assets), so there is
// no licensing concern. Each sprite is painted on a small canvas and turned
// into a Pixi texture with nearest-neighbour scaling.
import { Texture } from "pixi.js";

type Ctx = CanvasRenderingContext2D;

const OUTLINE = "#1b1a24";

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Adds a 1px outline around every opaque pixel (outer edge only). */
function outline(ctx: Ctx, w: number, h: number, color = OUTLINE) {
  const img = ctx.getImageData(0, 0, w, h);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.data[(y * w + x) * 4 + 3]!);
  const edge: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) edge.push([x, y]);
  for (const [x, y] of edge) px(ctx, x, y, 1, 1, color);
}

function toTexture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

// ---------------------------------------------------------------- characters

export const CHAR_W = 16;
export const CHAR_H = 24;

export type Pose =
  | "stand"
  | "walk1"
  | "walk2"
  | "sit"
  | "type1"
  | "type2"
  | "read"
  | "hand1"
  | "hand2"
  | "stretch"
  | "sleep";

export interface Look {
  hair: string;
  skin: string;
  shirt: string;
  pants: string;
  /** Lead only: jacket over a white shirt with a tie. */
  jacket?: string;
  tie?: string;
}

const SKINS = ["#f2c7a5", "#e0a982", "#c68863", "#8d5a3b"];
const HAIRS = ["#2b2125", "#5a3a29", "#a5652f", "#d9b25f", "#8c8c99", "#b0442f"];
const SHIRTS = ["#3fa7a0", "#5b9e4b", "#d9813b", "#8a63c9", "#d0607d", "#4f8fd6", "#c9a43b"];
const PANTS = ["#3a4256", "#4b3f36", "#2f3a33"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const LEAD_LOOK: Look = {
  hair: "#2b2125",
  skin: SKINS[0]!,
  shirt: "#eef0f4",
  pants: "#262b3a",
  jacket: "#2d3a5c",
  tie: "#c8413f",
};

/** Staff look: shirt colour by agent type (a team uniform), hair/skin by id. */
export function staffLook(id: string, type?: string): Look {
  const h = hash(id);
  return {
    hair: HAIRS[h % HAIRS.length]!,
    skin: SKINS[(h >>> 8) % SKINS.length]!,
    shirt: SHIRTS[hash(type ?? id) % SHIRTS.length]!,
    pants: PANTS[(h >>> 16) % PANTS.length]!,
  };
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function drawCharacter(ctx: Ctx, look: Look, pose: Pose) {
  const bob = pose === "walk1" || pose === "walk2" ? -1 : 0;
  const headDrop = pose === "sleep" ? 1 : 0;
  const y0 = 1 + bob;

  // legs + shoes (hidden behind the desk when seated, but drawn anyway)
  const legL = pose === "walk1" ? -1 : 0;
  const legR = pose === "walk2" ? -1 : 0;
  px(ctx, 5, y0 + 16 + legL, 3, 4, look.pants);
  px(ctx, 8, y0 + 16 + legR, 3, 4, look.pants);
  px(ctx, 5, y0 + 20 + legL, 3, 1, "#2a2224");
  px(ctx, 8, y0 + 20 + legR, 3, 1, "#2a2224");

  // torso
  const body = look.jacket ?? look.shirt;
  px(ctx, 4, y0 + 10, 8, 6, body);
  px(ctx, 4, y0 + 15, 8, 1, shade(body, 0.8));
  if (look.jacket) {
    px(ctx, 6, y0 + 10, 4, 5, look.shirt);
    px(ctx, 7, y0 + 10, 2, 5, look.tie ?? "#c8413f");
    px(ctx, 7, y0 + 10, 2, 1, shade(look.tie ?? "#c8413f", 0.75));
  } else {
    px(ctx, 6, y0 + 10, 4, 1, shade(look.shirt, 1.2));
  }

  // arms
  const sleeve = body;
  const arm = (x: number, up: boolean, handY?: number) => {
    if (up) {
      // raised arm sits outside the head so it reads clearly
      const ax = x < 8 ? x - 1 : x + 1;
      px(ctx, ax, y0 + 3, 2, 8, sleeve);
      px(ctx, ax, y0 + 1, 2, 2, look.skin);
    } else if (handY !== undefined) {
      // forearm forward onto the desk
      px(ctx, x, y0 + 10, 2, 4, sleeve);
      px(ctx, x + (x < 8 ? 1 : -1), y0 + handY, 2, 2, look.skin);
    } else {
      px(ctx, x, y0 + 10, 2, 5, sleeve);
      px(ctx, x, y0 + 15, 2, 1, look.skin);
    }
  };
  switch (pose) {
    case "hand1":
    case "hand2":
      arm(2, false, 13);
      arm(12, true);
      break;
    case "stretch":
      arm(2, true);
      arm(12, true);
      break;
    case "type1":
      arm(2, false, 13);
      arm(12, false, 14);
      break;
    case "type2":
      arm(2, false, 14);
      arm(12, false, 13);
      break;
    case "read":
    case "sit":
    case "sleep":
      arm(2, false, 14);
      arm(12, false, 14);
      break;
    default:
      arm(2, false);
      arm(12, false);
  }

  // neck + head
  const hy = y0 + headDrop;
  px(ctx, 7, hy + 9, 2, 1, shade(look.skin, 0.85));
  px(ctx, 4, hy + 2, 8, 7, look.skin);
  px(ctx, 4, hy + 0, 8, 3, look.hair);
  px(ctx, 3, hy + 1, 1, 4, look.hair);
  px(ctx, 12, hy + 1, 1, 4, look.hair);
  px(ctx, 5, hy + 3, 2, 1, look.hair);
  // face
  const eye = "#231c22";
  if (pose === "sleep") {
    px(ctx, 5, hy + 5, 2, 1, eye);
    px(ctx, 9, hy + 5, 2, 1, eye);
  } else {
    const ey = pose === "read" ? hy + 5 : hy + 4;
    px(ctx, 6, ey, 1, 2, eye);
    px(ctx, 9, ey, 1, 2, eye);
  }
  px(ctx, 4, hy + 6, 1, 1, shade(look.skin, 0.9));
  px(ctx, 11, hy + 6, 1, 1, shade(look.skin, 0.9));
  if (pose === "stretch") px(ctx, 7, hy + 7, 2, 1, "#8a3b3b");
  else px(ctx, 7, hy + 7, 2, 1, shade(look.skin, 0.75));

}

const charCache = new Map<string, Texture>();

export function characterTexture(look: Look, pose: Pose): Texture {
  const key = `${JSON.stringify(look)}|${pose}`;
  let t = charCache.get(key);
  if (!t) {
    const [c, ctx] = canvas(CHAR_W, CHAR_H);
    drawCharacter(ctx, look, pose);
    outline(ctx, CHAR_W, CHAR_H);
    t = toTexture(c);
    charCache.set(key, t);
  }
  return t;
}

// ----------------------------------------------------------------- furniture

export const DESK_W = 40;
export const DESK_H = 16;
export const LEAD_DESK_W = 48;
export const LEAD_DESK_H = 18;

function deskTexture(w: number, h: number, top: string, front: string, lead: boolean): Texture {
  const [c, ctx] = canvas(w + 2, h + 2);
  ctx.translate(1, 1);
  px(ctx, 0, 0, w, 4, top);
  px(ctx, 0, 3, w, 1, shade(top, 0.85));
  px(ctx, 0, 4, w, h - 4, front);
  px(ctx, 0, h - 1, w, 1, shade(front, 0.7));
  // drawers / panels
  px(ctx, 2, 6, w - 4, 1, shade(front, 0.82));
  const drawers = lead ? [4, w - 14] : [w - 12];
  for (const x of drawers) {
    px(ctx, x, 7, 10, h - 9, shade(front, 1.08));
    px(ctx, x + 4, 9, 2, 1, "#d8c27a");
  }
  if (lead) {
    // name plate
    px(ctx, w / 2 - 7, 8, 14, 4, "#d8c27a");
    px(ctx, w / 2 - 6, 9, 12, 2, "#b0954a");
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  outline(ctx, w + 2, h + 2);
  return toTexture(c);
}

let deskCache: { sub: Texture; lead: Texture } | undefined;
export function deskTextures() {
  deskCache ??= {
    sub: deskTexture(DESK_W, DESK_H, "#c99a5e", "#9b6d3e", false),
    lead: deskTexture(LEAD_DESK_W, LEAD_DESK_H, "#8f5a3c", "#6a3f2a", true),
  };
  return deskCache;
}

export const CHAIR_W = 20;
export const CHAIR_H = 16;

/** Chair back, wider than a character's shoulders so it peeks out behind them. */
export function chairTexture(lead: boolean): Texture {
  const [c, ctx] = canvas(CHAIR_W, CHAIR_H);
  const col = lead ? "#6b2f36" : "#3f4a63";
  px(ctx, 1, 1, 18, 14, col);
  px(ctx, 2, 2, 16, 2, shade(col, 1.3));
  px(ctx, 1, 14, 18, 1, shade(col, 0.7));
  if (lead) px(ctx, 1, 0, 18, 2, shade(col, 1.15));
  outline(ctx, CHAIR_W, CHAIR_H);
  return toTexture(c);
}

export type ScreenMode = "off" | "idle" | "thinking" | "reading" | "writing" | "running" | "waiting";
export const MONITOR_W = 14;
export const MONITOR_H = 14;

const monitorCache = new Map<string, Texture>();

/** Monitor with its screen content; `frame` animates scrolling text/blink. */
export function monitorTexture(mode: ScreenMode, frame: number): Texture {
  const key = `${mode}|${frame % 4}`;
  let t = monitorCache.get(key);
  if (t) return t;
  const [c, ctx] = canvas(MONITOR_W, MONITOR_H);
  px(ctx, 1, 1, 12, 9, "#2c2f3a");
  const screenBg: Record<ScreenMode, string> = {
    off: "#15171d",
    idle: "#1d2a3a",
    thinking: "#2a2f45",
    reading: "#1e3550",
    writing: "#2f2a1c",
    running: "#0f2416",
    waiting: frame % 2 ? "#5a1f24" : "#7a2a2f",
  };
  px(ctx, 2, 2, 10, 7, screenBg[mode]);
  const f = frame % 4;
  const lines = (color: string, widths: number[]) =>
    widths.forEach((w, i) => px(ctx, 3, 3 + i * 2, Math.max(1, (w + f * (i + 1)) % 9), 1, color));
  if (mode === "reading") lines("#8fc6ff", [7, 5, 8]);
  if (mode === "writing") lines("#ffd77a", [4, 8, 6]);
  if (mode === "running") {
    px(ctx, 3, 3, 1, 1, "#7dff9a");
    lines("#58d873", [3, 6, 4]);
  }
  if (mode === "thinking") for (let i = 0; i < 3; i++) if (i <= f % 3) px(ctx, 4 + i * 2, 5, 1, 1, "#b8bde0");
  if (mode === "waiting") {
    px(ctx, 6, 3, 2, 3, "#ffe08a");
    px(ctx, 6, 7, 2, 1, "#ffe08a");
  }
  // stand
  px(ctx, 6, 10, 2, 2, "#3a3e4b");
  px(ctx, 4, 12, 6, 1, "#3a3e4b");
  outline(ctx, MONITOR_W, MONITOR_H);
  t = toTexture(c);
  monitorCache.set(key, t);
  return t;
}

export function exclamationTexture(): Texture {
  const [c, ctx] = canvas(6, 10);
  px(ctx, 1, 0, 4, 6, "#ffd23f");
  px(ctx, 1, 7, 4, 2, "#ffd23f");
  outline(ctx, 6, 10);
  return toTexture(c);
}

// ---------------------------------------------------------------------- room

export const ROOM_W = 352;
export const ROOM_H = 208;
export const WALL_H = 48;

function plant(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 3, y + 12, 8, 7, "#b5643a");
  px(ctx, x + 3, y + 12, 8, 1, "#d27d4b");
  const leaf = "#3f9b4f";
  px(ctx, x + 5, y + 2, 4, 10, leaf);
  px(ctx, x + 1, y + 5, 4, 5, leaf);
  px(ctx, x + 9, y + 4, 4, 6, leaf);
  px(ctx, x + 6, y, 2, 3, "#57b866");
  px(ctx, x + 2, y + 5, 2, 2, "#57b866");
}

/** Static background: wall, windows, door, floor and decoration. */
export function roomTexture(): Texture {
  const [c, ctx] = canvas(ROOM_W, ROOM_H);

  // floor: wooden planks
  for (let y = WALL_H; y < ROOM_H; y += 8) {
    const row = (y - WALL_H) / 8;
    px(ctx, 0, y, ROOM_W, 8, row % 2 ? "#b88a5c" : "#bf9263");
    px(ctx, 0, y + 7, ROOM_W, 1, "#9f744b");
    for (let x = (row % 3) * 13; x < ROOM_W; x += 40) px(ctx, x, y, 1, 7, "#a57a4f");
  }
  // rug under the lead desk
  px(ctx, 136, 54, 80, 34, "#7a3b46");
  px(ctx, 139, 57, 74, 28, "#93505a");
  px(ctx, 141, 59, 70, 24, "#7a3b46");

  // wall
  px(ctx, 0, 0, ROOM_W, WALL_H, "#d7d2c4");
  px(ctx, 0, 0, ROOM_W, 6, "#c5bfae");
  px(ctx, 0, WALL_H - 5, ROOM_W, 5, "#8a6a4a");
  px(ctx, 0, WALL_H - 5, ROOM_W, 1, "#a7835e");

  // windows
  for (const wx of [72, 232, 288]) {
    px(ctx, wx, 10, 40, 24, "#efe9da");
    px(ctx, wx + 2, 12, 36, 20, "#8ecae6");
    px(ctx, wx + 2, 12, 36, 6, "#b5dcef");
    px(ctx, wx + 19, 12, 2, 20, "#efe9da");
    px(ctx, wx + 2, 21, 36, 2, "#efe9da");
    px(ctx, wx + 6, 26, 8, 3, "#e9f5fb");
  }
  // whiteboard
  px(ctx, 130, 9, 92, 28, "#9aa0ab");
  px(ctx, 132, 11, 88, 24, "#f7f8fa");
  px(ctx, 136, 15, 30, 2, "#4f8fd6");
  px(ctx, 136, 20, 44, 2, "#d0607d");
  px(ctx, 136, 25, 22, 2, "#5b9e4b");
  px(ctx, 186, 14, 26, 14, "#ffe9a8");
  px(ctx, 150, 35, 30, 2, "#7b818c");
  // clock
  px(ctx, 330, 12, 12, 12, "#f4f1e8");
  px(ctx, 335, 14, 2, 5, "#2b2125");
  px(ctx, 335, 18, 4, 1, "#2b2125");

  // door (left wall), slightly open frame
  px(ctx, 14, 8, 24, WALL_H - 8, "#6b4a33");
  px(ctx, 16, 10, 20, WALL_H - 10, "#8d6443");
  px(ctx, 18, 12, 16, 12, "#9d7250");
  px(ctx, 18, 27, 16, 14, "#9d7250");
  px(ctx, 32, 28, 2, 3, "#e3c56b");
  // doormat
  px(ctx, 12, WALL_H, 28, 6, "#5a6b4f");

  // decoration
  plant(ctx, 4, 186);
  plant(ctx, 332, 186);
  plant(ctx, 46, 30);
  // water cooler
  px(ctx, 318, 52, 14, 22, "#e6e9ef");
  px(ctx, 320, 40, 10, 12, "#8ecae6");
  px(ctx, 322, 58, 3, 2, "#4f8fd6");
  // bookshelf
  px(ctx, 296, 50, 18, 30, "#7a5536");
  for (let i = 0; i < 3; i++) {
    px(ctx, 298, 52 + i * 9, 14, 7, "#5c3e27");
    ["#c8413f", "#4f8fd6", "#5b9e4b", "#d9b25f"].forEach((col, j) => px(ctx, 299 + j * 3, 53 + i * 9, 2, 6, col));
  }

  return toTexture(c);
}
