import { Container, Graphics, Text } from "pixi.js";
import type { AgentStatus } from "@ai-office/shared";

const BORDER: Record<AgentStatus, number> = {
  idle: 0x9aa0ab,
  thinking: 0x9aa0ab,
  reading: 0x4f8fd6,
  writing: 0xd9a53b,
  running: 0x3fae5c,
  waiting: 0xe04b4b,
  done: 0x8a63c9,
};

const MAX_CHARS = 24;
const FONT = 'ui-monospace, "Cascadia Code", Consolas, "Nanum Gothic", "Malgun Gothic", monospace';

/** Pixel-style speech bubble, drawn in screen space (unscaled) so text stays crisp. */
export class Bubble extends Container {
  private bg = new Graphics();
  private textView: Text;
  private current = "";
  private currentStatus: AgentStatus | undefined;

  constructor() {
    super();
    this.textView = new Text({
      text: "",
      style: { fontFamily: FONT, fontSize: 12, fill: 0x1f2330 },
      resolution: Math.max(2, globalThis.devicePixelRatio ?? 1),
    });
    this.addChild(this.bg, this.textView);
    this.visible = false;
  }

  set(text: string | undefined, status: AgentStatus) {
    if (!text) {
      this.visible = false;
      this.current = "";
      return;
    }
    this.visible = true;
    const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
    if (clipped === this.current && status === this.currentStatus) return;
    this.current = clipped;
    this.currentStatus = status;
    this.textView.text = clipped;

    const padX = 6;
    const padY = 3;
    const w = Math.ceil(this.textView.width) + padX * 2;
    const h = Math.ceil(this.textView.height) + padY * 2;
    const border = BORDER[status];
    const g = this.bg.clear();
    // body with a 2px border and squared corners (pixel look)
    g.rect(-w / 2, -h - 6, w, h).fill(border);
    g.rect(-w / 2 + 2, -h - 4, w - 4, h - 4).fill(0xfbfaf5);
    // tail
    g.rect(-3, -6, 6, 2).fill(border);
    g.rect(-1, -4, 2, 2).fill(border);
    this.textView.position.set(-w / 2 + padX, -h - 6 + padY);
  }
}
