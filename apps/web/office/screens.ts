// Animated monitor screens, drawn on small canvases. One texture per mode is
// shared by every monitor showing that mode, so a hundred monitors still
// cost seven tiny canvas redraws per frame step.
import * as THREE from "three";
import type { AgentStatus } from "@ai-office/shared";

export type ScreenMode = "off" | "idle" | "thinking" | "reading" | "writing" | "running" | "waiting";

export const SCREEN_MODE: Record<AgentStatus, ScreenMode> = {
  idle: "idle",
  thinking: "thinking",
  reading: "reading",
  writing: "writing",
  running: "running",
  waiting: "waiting",
  done: "idle",
};

const W = 64;
const H = 40;

interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
}

const screens = new Map<ScreenMode, Screen>();

function make(mode: ScreenMode): Screen {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  // Unlit so screens glow regardless of room lighting; "off" stays dark.
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const s = { canvas, ctx, texture, material };
  draw(mode, s, 0);
  return s;
}

export function screenMaterial(mode: ScreenMode): THREE.MeshBasicMaterial {
  let s = screens.get(mode);
  if (!s) {
    s = make(mode);
    screens.set(mode, s);
  }
  return s.material;
}

let lastFrame = -1;

/** Advances screen animations; call once per rendered frame. */
export function updateScreens(now: number) {
  const frame = Math.floor(now / 180);
  if (frame === lastFrame) return;
  lastFrame = frame;
  for (const [mode, s] of screens) {
    draw(mode, s, frame);
    s.texture.needsUpdate = true;
  }
}

const BG: Record<ScreenMode, string> = {
  off: "#0b0d12",
  idle: "#16243a",
  thinking: "#1f2438",
  reading: "#13263f",
  writing: "#1c1a14",
  running: "#07150c",
  waiting: "#3a0e14",
};

function draw(mode: ScreenMode, { ctx }: Screen, f: number) {
  ctx.fillStyle = BG[mode];
  ctx.fillRect(0, 0, W, H);
  const line = (x: number, y: number, w: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 2);
  };
  switch (mode) {
    case "idle": {
      // drifting screensaver dot
      const t = f / 20;
      ctx.fillStyle = "#4f8fd6";
      ctx.fillRect(28 + Math.round(Math.cos(t) * 20), 18 + Math.round(Math.sin(t * 1.3) * 12), 4, 4);
      break;
    }
    case "thinking":
      ctx.fillStyle = "#b8bde0";
      for (let i = 0; i < 3; i++) if (i <= f % 4) ctx.fillRect(22 + i * 8, 18, 4, 4);
      break;
    case "reading":
      for (let i = 0; i < 8; i++) {
        const w = 12 + ((i * 37 + f * 3) % 36);
        line(6, 4 + i * 4 - (f % 4), w, i % 3 ? "#8fc6ff" : "#cfe6ff");
      }
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(4, 14, 56, 6);
      break;
    case "writing": {
      const rows = 1 + (f % 8);
      for (let i = 0; i < rows; i++) line(6 + (i % 3) * 4, 4 + i * 4, 10 + ((i * 29) % 30), i % 2 ? "#ffd77a" : "#f2a65a");
      if (f % 2) ctx.fillRect(6 + ((rows - 1) % 3) * 4 + 10 + (((rows - 1) * 29) % 30) + 2, 4 + (rows - 1) * 4, 2, 3);
      break;
    }
    case "running":
      for (let i = 0; i < 8; i++) {
        const k = i + f;
        line(4, 4 + i * 4, 3, "#7dff9a");
        line(9, 4 + i * 4, 8 + ((k * 23) % 40), "#58d873");
      }
      break;
    case "waiting":
      ctx.fillStyle = f % 4 < 2 ? "#ff5a5f" : "#c23a40";
      ctx.fillRect(0, 0, W, 3);
      ctx.fillRect(0, H - 3, W, 3);
      ctx.fillStyle = "#ffe08a";
      ctx.fillRect(30, 9, 4, 14);
      ctx.fillRect(30, 26, 4, 4);
      break;
  }
}
