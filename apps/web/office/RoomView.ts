import { Container, Graphics, Rectangle, Sprite, Text } from "pixi.js";
import type { AgentStatus, RoomActivity, RoomState, SessionMap } from "@ai-office/shared";
import { AgentSprite } from "./AgentSprite";
import { podDesks, podOrigin, roomSize, standingSpot, type DeskSpot, type Point } from "./layout";
import { chairTexture, deskTextures, monitorTexture, roomTexture, type ScreenMode } from "./sprites";
import { visualStatus } from "./status";

export interface RoomInput {
  room: RoomState;
  sessions: SessionMap;
  label: string;
  activity: RoomActivity;
}

interface DeskView {
  spot: DeskSpot;
  monitor: Sprite;
  front: number;
}

const SCREEN: Record<AgentStatus, ScreenMode> = {
  idle: "idle",
  thinking: "thinking",
  reading: "reading",
  writing: "writing",
  running: "running",
  waiting: "waiting",
  done: "idle",
};

const TITLE_COLOR: Record<RoomActivity, number> = {
  waiting: 0xff8a80,
  working: 0xa3e4a0,
  idle: 0xd8dee9,
  empty: 0x7b8496,
};

const deskKey = (pod: number, desk: number) => `${pod}:${desk}`;

/**
 * One project room. `world` is pixel art in room coordinates (the scene
 * scales and places it); `ui` holds crisp unscaled text in screen space.
 */
export class RoomView {
  readonly world = new Container({ sortableChildren: true });
  readonly ui = new Container();
  size = roomSize(1);

  private readonly bg = new Sprite();
  private readonly dim = new Graphics();
  private readonly title: Text;
  private readonly emptyLabel: Text;
  private readonly desks = new Map<string, DeskView>();
  private readonly agents = new Map<string, AgentSprite>();
  private readonly leaving = new Set<AgentSprite>();
  private podCount = -1;
  private activity: RoomActivity = "empty";
  private scale = 1;
  private showTitle = false;

  constructor(
    readonly key: string,
    onClick: (key: string) => void,
  ) {
    this.bg.zIndex = -1_000;
    this.dim.zIndex = 20_000;
    this.world.addChild(this.bg, this.dim);
    this.world.on("pointertap", () => onClick(key));

    const font = "ui-sans-serif, system-ui, 'Nanum Gothic', sans-serif";
    this.title = new Text({ text: "", style: { fontFamily: font, fontSize: 13, fontWeight: "bold", fill: 0xd8dee9 }, resolution: 2 });
    this.title.anchor.set(0, 1);
    this.emptyLabel = new Text({ text: "비움 · 모두 퇴근", style: { fontFamily: font, fontSize: 14, fill: 0xc8cdd8 }, resolution: 2 });
    this.emptyLabel.anchor.set(0.5);
    this.ui.addChild(this.title, this.emptyLabel);
  }

  /** Reconciles characters with the room's present sessions. `firstPaint` seats everyone without walking in. */
  sync({ room, sessions, label, activity }: RoomInput, firstPaint: boolean) {
    this.activity = activity;
    this.title.text = `${activity === "waiting" ? "! " : ""}${label}`;
    this.title.style.fill = TITLE_COLOR[activity];

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
        const existing = this.agents.get(key);
        if (existing) {
          existing.agent = agent;
          existing.deskKey = spot ? deskKey(pod, agent.desk) : undefined;
          existing.moveHome(home, !!spot);
          continue;
        }
        const name =
          agent.kind === "main" ? (multi ? `팀장 ${session.sessionId.slice(0, 4)}` : "팀장") : (agent.type ?? "직원");
        const sprite = new AgentSprite(agent, home, !!spot, !firstPaint, name, this.world, this.ui);
        sprite.deskKey = spot ? deskKey(pod, agent.desk) : undefined;
        this.agents.set(key, sprite);
      }
    });
    for (const [key, sprite] of this.agents) {
      if (wanted.has(key)) continue;
      sprite.leave();
      this.agents.delete(key);
      this.leaving.add(sprite);
    }
  }

  private rebuild(pods: number) {
    this.podCount = pods;
    this.size = roomSize(pods);
    const origins = Array.from({ length: pods }, (_, i) => podOrigin(i));
    this.bg.texture = roomTexture(this.size.w, this.size.h, origins);
    this.world.hitArea = new Rectangle(0, 0, this.size.w, this.size.h);
    this.dim.clear().rect(0, 0, this.size.w, this.size.h).fill({ color: 0x0b0d14, alpha: 0.5 });

    // Furniture shares the world's z-ordering with characters, so it lives directly in world.
    for (const child of this.world.children.filter((c) => c.label === "furniture")) child.destroy();
    this.desks.clear();
    for (let pod = 0; pod < pods; pod++) for (const spot of podDesks(pod)) this.addDesk(spot);
  }

  private addDesk(spot: DeskSpot) {
    const chair = new Sprite(chairTexture(spot.lead));
    chair.anchor.set(0.5, 1);
    // Top of the chair back sits at shoulder height of the seated character.
    chair.position.set(spot.seat.x, spot.seat.y - 2);
    chair.zIndex = spot.seat.y - 20;

    const desk = new Sprite(spot.lead ? deskTextures().lead : deskTextures().sub);
    desk.position.set(spot.desk.x - 1, spot.desk.y - 1);
    const front = spot.desk.y + spot.h;
    desk.zIndex = front;

    const monitor = new Sprite(monitorTexture("off", 0));
    monitor.position.set(spot.monitor.x, spot.monitor.y);
    monitor.zIndex = front + 1;

    for (const s of [chair, desk, monitor]) s.label = "furniture";
    this.world.addChild(chair, desk, monitor);
    this.desks.set(deskKey(spot.pod, spot.index), { spot, monitor, front });
  }

  /** Places the room on screen. */
  layout(x: number, y: number, scale: number, showTitle: boolean, clickable: boolean) {
    this.scale = scale;
    this.showTitle = showTitle;
    this.world.position.set(Math.round(x), Math.round(y));
    this.world.scale.set(scale);
    this.world.eventMode = clickable ? "static" : "none";
    this.world.cursor = clickable ? "pointer" : "default";
    this.title.position.set(Math.round(x + 2), Math.round(y - 4));
    this.emptyLabel.position.set(Math.round(x + (this.size.w * scale) / 2), Math.round(y + (this.size.h * scale) / 2));
  }

  set visible(v: boolean) {
    this.world.visible = v;
    this.ui.visible = v;
  }

  private toScreen = (p: Point): Point => ({
    x: this.world.x + p.x * this.scale,
    y: this.world.y + p.y * this.scale,
  });

  tick(dtMs: number, now: number, frame: number, detail: boolean) {
    const empty = this.activity === "empty" && this.agents.size === 0 && this.leaving.size === 0;
    this.dim.visible = empty;
    this.emptyLabel.visible = empty;
    this.title.visible = this.showTitle;

    const occupied = new Map<string, AgentSprite>();
    for (const a of this.agents.values()) if (a.deskKey) occupied.set(a.deskKey, a);
    for (const [key, desk] of this.desks) {
      const a = occupied.get(key);
      desk.monitor.texture = monitorTexture(a ? SCREEN[visualStatus(a.agent, now)] : "off", frame);
    }
    for (const a of this.agents.values()) {
      a.update(dtMs, now, this.toScreen, this.scale, detail, a.deskKey ? this.desks.get(a.deskKey)?.front : undefined);
    }
    for (const a of this.leaving) {
      a.update(dtMs, now, this.toScreen, this.scale, detail);
      if (a.done) {
        a.destroy();
        this.leaving.delete(a);
      }
    }
  }

  destroy() {
    for (const a of [...this.agents.values(), ...this.leaving]) a.destroy();
    this.world.destroy({ children: true });
    this.ui.destroy({ children: true });
  }
}
