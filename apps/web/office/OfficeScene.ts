import { Application, Container, Sprite, Text } from "pixi.js";
import type { AgentStatus, SessionState } from "@ai-office/shared";
import { AgentSprite } from "./AgentSprite";
import { visualStatus } from "./status";
import { LEAD_DESK, SUB_DESKS, deskSpot, standingSpot, type DeskSpot, type Point } from "./layout";
import { ROOM_H, ROOM_W, chairTexture, deskTextures, monitorTexture, roomTexture, type ScreenMode } from "./sprites";

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

/** The office: a scaled pixel "world" layer plus an unscaled UI layer for text. */
export class OfficeScene {
  private readonly world = new Container({ sortableChildren: true });
  private readonly ui = new Container();
  private readonly desks = new Map<number, DeskView>();
  private readonly agents = new Map<string, AgentSprite>();
  private readonly leaving = new Set<AgentSprite>();
  private readonly overlay: Text;
  private sessionId: string | undefined;
  private scale = 1;

  private constructor(private readonly app: Application) {
    app.stage.addChild(this.world, this.ui);
    this.world.addChild(new Sprite(roomTexture()));
    for (const spot of [LEAD_DESK, ...SUB_DESKS]) this.addDesk(spot);

    this.overlay = new Text({
      text: "",
      style: { fontFamily: "ui-sans-serif, system-ui, 'Nanum Gothic', sans-serif", fontSize: 14, fill: 0xffffff },
      resolution: 2,
    });
    this.overlay.anchor.set(0.5);
    this.ui.addChild(this.overlay);

    app.renderer.on("resize", () => this.layout());
    this.layout();
    app.ticker.add((t) => this.tick(t.deltaMS));
  }

  static async create(host: HTMLElement): Promise<OfficeScene> {
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
    return new OfficeScene(app);
  }

  private addDesk(spot: DeskSpot) {
    const textures = deskTextures();
    const chair = new Sprite(chairTexture(spot.lead));
    chair.anchor.set(0.5, 1);
    // Top of the chair back sits at shoulder height of the seated character.
    chair.position.set(spot.seat.x, spot.seat.y - 2);
    chair.zIndex = spot.seat.y - 20;

    const desk = new Sprite(spot.lead ? textures.lead : textures.sub);
    desk.position.set(spot.desk.x - 1, spot.desk.y - 1);
    const front = spot.desk.y + spot.h;
    desk.zIndex = front;

    const monitor = new Sprite(monitorTexture("off", 0));
    monitor.position.set(spot.monitor.x, spot.monitor.y);
    monitor.zIndex = front + 1;

    this.world.addChild(chair, desk, monitor);
    this.desks.set(spot.index, { spot, monitor, front });
  }

  private layout() {
    const { width, height } = this.app.screen;
    const fit = Math.min(width / ROOM_W, height / ROOM_H);
    // Integer scaling keeps pixels square; fall back to fractional on tiny screens.
    this.scale = fit >= 1 ? Math.floor(fit) : fit;
    this.world.scale.set(this.scale);
    this.world.position.set(
      Math.round((width - ROOM_W * this.scale) / 2),
      Math.round((height - ROOM_H * this.scale) / 2),
    );
    this.overlay.position.set(width / 2, this.world.y + 14 * this.scale);
  }

  private toScreen = (p: Point): Point => ({
    x: this.world.x + p.x * this.scale,
    y: this.world.y + p.y * this.scale,
  });

  /** Reconciles the scene with the server's session state. */
  sync(session: SessionState | undefined) {
    const switched = session?.sessionId !== this.sessionId;
    this.sessionId = session?.sessionId;
    if (switched) {
      for (const a of this.agents.values()) a.destroy();
      this.agents.clear();
      for (const a of this.leaving) a.destroy();
      this.leaving.clear();
    }

    this.overlay.text = !session
      ? "Claude Code 세션을 기다리는 중…"
      : session.ended
        ? "세션 종료됨"
        : "";

    const agents = session ? Object.values(session.agents) : [];
    let standing = 0;
    for (const agent of agents) {
      const spot = deskSpot(agent.desk);
      const home = spot ? spot.seat : standingSpot(standing++);
      const existing = this.agents.get(agent.key);
      if (existing) {
        existing.agent = agent;
        existing.moveHome(home, !!spot);
      } else {
        // Staff appearing live walk in; anything present on first paint is already seated.
        const walkIn = !switched && agent.kind === "sub";
        this.agents.set(agent.key, new AgentSprite(agent, home, !!spot, walkIn, this.world, this.ui));
      }
    }
    const present = new Set(agents.map((a) => a.key));
    for (const [key, sprite] of this.agents) {
      if (present.has(key)) continue;
      sprite.leave();
      this.agents.delete(key);
      this.leaving.add(sprite);
    }
  }

  private tick(dtMs: number) {
    const now = Date.now();
    const frame = Math.floor(now / 250);
    const occupied = new Map<number, AgentSprite>();
    for (const a of this.agents.values()) if (a.agent.desk >= 0) occupied.set(a.agent.desk, a);

    for (const [index, desk] of this.desks) {
      const a = occupied.get(index);
      const mode: ScreenMode = a ? SCREEN[visualStatus(a.agent, now)] : "off";
      desk.monitor.texture = monitorTexture(mode, frame);
    }
    for (const a of this.agents.values()) {
      a.update(dtMs, now, this.toScreen, this.scale, this.desks.get(a.agent.desk)?.front);
    }
    for (const a of this.leaving) {
      a.update(dtMs, now, this.toScreen, this.scale);
      if (a.done) {
        a.destroy();
        this.leaving.delete(a);
      }
    }
  }

  destroy() {
    this.app.destroy(true, { children: true });
  }
}
