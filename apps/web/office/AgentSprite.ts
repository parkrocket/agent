import { Container, Sprite, Text } from "pixi.js";
import type { AgentState, AgentStatus } from "@ai-office/shared";
import { Bubble } from "./Bubble";
import { CHAR_H, CHAR_W, LEAD_LOOK, characterTexture, exclamationTexture, staffLook, type Look, type Pose } from "./sprites";
import { pathBetween, pathFromDoor, pathToDoor, type Point } from "./layout";
import { visualStatus } from "./status";

const STRETCH_MS = 2_500;
const DONE_BUBBLE_MS = 5_000;
const WALK_SPEED = 48; // base px per second

export function bubbleText(agent: AgentState, status: AgentStatus, now: number): string | undefined {
  const target = [agent.tool, agent.file].filter(Boolean).join(" ");
  switch (status) {
    case "waiting":
      return agent.tool ? `승인 대기: ${target}` : "입력 기다리는 중";
    case "reading":
    case "writing":
    case "running":
      return target || agent.tool;
    case "thinking":
      return target || ".".repeat(1 + (Math.floor(now / 400) % 3));
    case "done":
      return now - agent.since < DONE_BUBBLE_MS ? "완료!" : undefined;
    default:
      return undefined;
  }
}

type Mode = "entering" | "seated" | "leaving" | "gone";

/**
 * One character. World-space parts (body, "!") live in the scaled world
 * layer; bubble and labels live in the unscaled UI layer.
 */
export class AgentSprite {
  readonly body: Sprite;
  readonly bubble = new Bubble();
  readonly name: Text;
  readonly zzz: Text;
  private readonly exclaim: Sprite;
  private readonly look: Look;

  agent: AgentState;
  pos: Point;
  /** Where this agent belongs (seat or standing spot). */
  home: Point;
  seatedAtDesk: boolean;
  /** "pod:desk" of the desk this agent sits at, if any (set by the room). */
  deskKey?: string;
  private path: Point[] = [];
  private mode: Mode;

  constructor(
    agent: AgentState,
    home: Point,
    seatedAtDesk: boolean,
    walkIn: boolean,
    displayName: string,
    private readonly world: Container,
    private readonly ui: Container,
  ) {
    this.agent = agent;
    this.home = home;
    this.seatedAtDesk = seatedAtDesk;
    this.look = agent.kind === "main" ? LEAD_LOOK : staffLook(agent.key, agent.type);

    this.body = new Sprite(characterTexture(this.look, "stand"));
    this.body.anchor.set(0.5, 1);
    this.exclaim = new Sprite(exclamationTexture());
    this.exclaim.anchor.set(0.5, 1);
    this.exclaim.visible = false;
    world.addChild(this.body, this.exclaim);

    const labelStyle = { fontFamily: "ui-sans-serif, system-ui, 'Nanum Gothic', sans-serif", fontSize: 11 };
    this.name = new Text({
      text: displayName,
      style: { ...labelStyle, fill: agent.kind === "main" ? 0xffe08a : 0xe8ecf4, fontWeight: "bold" },
      resolution: 2,
    });
    this.name.anchor.set(0.5, 0);
    this.zzz = new Text({ text: "z", style: { ...labelStyle, fontSize: 14, fill: 0xdfe6ff, fontWeight: "bold" }, resolution: 2 });
    this.zzz.anchor.set(0.5, 1);
    ui.addChild(this.name, this.zzz, this.bubble);

    if (walkIn) {
      this.path = pathFromDoor(home);
      this.pos = { ...this.path.shift()! };
      this.mode = "entering";
    } else {
      this.pos = { ...home };
      this.mode = "seated";
    }
  }

  get leaving() {
    return this.mode === "leaving" || this.mode === "gone";
  }

  get done() {
    return this.mode === "gone";
  }

  moveHome(home: Point, seatedAtDesk: boolean) {
    if (home.x === this.home.x && home.y === this.home.y) return;
    this.home = home;
    this.seatedAtDesk = seatedAtDesk;
    if (this.mode === "seated") {
      this.path = pathBetween(this.pos, home);
      this.mode = "entering";
    }
  }

  leave() {
    if (this.leaving) return;
    this.path = pathToDoor(this.pos);
    this.mode = "leaving";
  }

  /** `detail` false (small lobby view) hides bubbles and name labels; "!" and "z" stay. */
  update(dtMs: number, now: number, toScreen: (p: Point) => Point, scale: number, detail: boolean, deskFront?: number) {
    const walking = this.step(dtMs);
    const status = visualStatus(this.agent, now);
    const seated = this.mode === "seated" && this.seatedAtDesk;

    this.body.texture = characterTexture(this.look, walking ? walkPose(now) : this.pose(status, now, seated));
    this.body.position.set(Math.round(this.pos.x), Math.round(this.pos.y));
    // Seated characters sit between their chair and desk; walkers sort by feet.
    this.body.zIndex = seated && deskFront !== undefined ? deskFront - 1 : this.pos.y;
    if (this.mode === "leaving" && this.pos.y < 52) this.body.alpha = Math.max(0, (this.pos.y - 44) / 8);

    const head = { x: this.pos.x, y: this.pos.y - CHAR_H };
    const waiting = status === "waiting" && !walking;
    this.exclaim.visible = waiting;
    if (waiting) {
      this.exclaim.position.set(Math.round(head.x + CHAR_W / 2 - 1), Math.round(head.y - 1 - Math.abs(Math.sin(now / 160)) * 3));
      this.exclaim.zIndex = 10_000;
    }

    const headScreen = toScreen({ x: head.x, y: head.y - (waiting ? 12 : 1) });
    const showUi = !this.leaving;
    this.bubble.set(showUi && detail && !walking ? bubbleText(this.agent, status, now) : undefined, status);
    this.bubble.position.set(Math.round(headScreen.x), Math.round(headScreen.y));
    // Text is drawn unscaled for crispness, but shrinks with the room on small screens.
    const textScale = Math.max(0.7, Math.min(1, scale / 2.5));
    this.bubble.scale.set(textScale);
    this.name.scale.set(textScale);

    const nameAt = toScreen(seated && deskFront !== undefined ? { x: this.pos.x, y: deskFront + 1 } : { x: this.pos.x, y: this.pos.y + 1 });
    this.name.position.set(Math.round(nameAt.x), Math.round(nameAt.y));
    this.name.visible = showUi && detail;

    const sleeping = status === "idle" && !walking && showUi;
    this.zzz.visible = sleeping;
    if (sleeping) {
      const t = (now % 2000) / 2000;
      const z = toScreen({ x: head.x + 7 + t * 4, y: head.y + 2 - t * 8 });
      this.zzz.position.set(Math.round(z.x), Math.round(z.y));
      this.zzz.alpha = 1 - t;
      this.zzz.scale.set(Math.max(0.6, scale / 3) * (0.7 + t * 0.5));
    }
  }

  private step(dtMs: number): boolean {
    if (this.mode !== "entering" && this.mode !== "leaving") return false;
    let budget = (WALK_SPEED * dtMs) / 1000;
    while (budget > 0 && this.path.length) {
      const target = this.path[0]!;
      const dx = target.x - this.pos.x;
      const dy = target.y - this.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        this.pos = { ...target };
        this.path.shift();
        budget -= dist;
      } else {
        this.pos = { x: this.pos.x + (dx / dist) * budget, y: this.pos.y + (dy / dist) * budget };
        budget = 0;
      }
    }
    if (!this.path.length) {
      this.mode = this.mode === "leaving" ? "gone" : "seated";
      return false;
    }
    return true;
  }

  private pose(status: AgentStatus, now: number, atDesk: boolean): Pose {
    const tick = Math.floor(now / 180) % 2;
    switch (status) {
      case "waiting":
        return "hand1";
      case "writing":
      case "running":
        return atDesk ? (tick ? "type1" : "type2") : "stand";
      case "reading":
        return atDesk ? "read" : "stand";
      case "done":
        return now - this.agent.since < STRETCH_MS ? "stretch" : atDesk ? "sit" : "stand";
      case "idle":
        return atDesk ? "sleep" : "stand";
      default:
        return atDesk ? "sit" : "stand";
    }
  }

  destroy() {
    this.world.removeChild(this.body, this.exclaim);
    this.ui.removeChild(this.name, this.zzz, this.bubble);
    this.body.destroy();
    this.exclaim.destroy();
    this.name.destroy();
    this.zzz.destroy();
    this.bubble.destroy({ children: true });
  }
}

function walkPose(now: number): Pose {
  return Math.floor(now / 150) % 2 ? "walk1" : "walk2";
}
