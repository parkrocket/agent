import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { AgentState, AgentStatus } from "@ai-office/shared";
import { cloneCharacter, partClip, type Assets, type CharacterName } from "./assets";
import { pathBetween, pathFromDoor, pathToDoor, type Point } from "./layout";
import { STRETCH_MS, bubbleText, visualStatus } from "./status";
import { gaugeLabel, gaugeLevel, type ContextGauge } from "@/lib/usage";

const WALK_SPEED = 1.6; // tiles per second
const CHAR_SCALE = 0.82;
/** Seated characters sit a little back from the seat point so they land on the chair. */
const SIT_BACK = 0.04;

const RING_COLOR: Record<AgentStatus, number> = {
  idle: 0x8a93a6,
  thinking: 0xb9c0d6,
  reading: 0x4f9cf0,
  writing: 0xf0b445,
  running: 0x4fd06f,
  waiting: 0xff5a5f,
  done: 0xa883f0,
};

type Mode = "entering" | "seated" | "leaving" | "gone";

/**
 * How much text to show: everything (zoomed into a room), a summary for the
 * whole floor (leads, and anyone waiting on the user), or nothing but the "!".
 */
export type Detail = "full" | "summary" | "none";

const ringGeometry = new THREE.RingGeometry(0.2, 0.27, 40).rotateX(-Math.PI / 2);
const rotX = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const rotZ = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);

/**
 * One character in a room (coordinates are the room's). Body animation is
 * layered: a lower-body clip (sit / walk / stand) plus an upper-body clip
 * chosen by status, with small bone tweaks on top (raised hand, nodding off).
 */
export class Agent {
  readonly root = new THREE.Group();
  agent: AgentState;
  home: Point;
  /** Desk unit rotation when seated at a desk; undefined when standing. */
  deskYaw: number | undefined;
  deskKey: string | undefined;
  /** Route from the elevator to just outside the room door (room-local); kept current by the room. */
  entry: Point[];
  /** Context window use, from the transcripts; undefined until usage is known. */
  gauge: ContextGauge | undefined;
  private readonly lead: boolean;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly bones: Record<"head" | "armLeft" | "armRight" | "torso", THREE.Object3D | undefined>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly label: CSS2DObject;
  private readonly el: {
    bubble: HTMLDivElement;
    badge: HTMLDivElement;
    zzz: HTMLDivElement;
    tag: HTMLDivElement;
    gauge: HTMLDivElement;
    gaugeFill: HTMLSpanElement;
    gaugeText: HTMLSpanElement;
  };
  private shownGauge = "";
  private readonly playing: { lower?: THREE.AnimationAction; upper?: THREE.AnimationAction } = {};
  private path: Point[] = [];
  private mode: Mode;
  private shown = { bubble: "", cls: "" };

  constructor(
    private readonly assets: Assets,
    agent: AgentState,
    look: CharacterName,
    home: Point,
    deskYaw: number | undefined,
    walkIn: boolean,
    displayName: string,
    entry: Point[],
  ) {
    this.agent = agent;
    this.home = home;
    this.deskYaw = deskYaw;
    this.entry = entry;
    this.lead = agent.kind === "main";

    this.model = cloneCharacter(assets, look);
    this.model.scale.setScalar(CHAR_SCALE);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const bone = (name: string) => this.model.getObjectByName(name);
    this.bones = { head: bone("head"), armLeft: bone("arm-left"), armRight: bone("arm-right"), torso: bone("torso") };

    this.ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: RING_COLOR.idle, transparent: true, opacity: 0.9 }));
    this.ring.position.y = 0.03;
    this.ring.renderOrder = 1;
    this.root.add(this.ring);

    const box = document.createElement("div");
    box.className = "o3-agent";
    const bubble = document.createElement("div");
    bubble.className = "o3-bubble";
    const badge = document.createElement("div");
    badge.className = "o3-badge";
    badge.textContent = "!";
    const zzz = document.createElement("div");
    zzz.className = "o3-zzz";
    zzz.textContent = "z";
    const tag = document.createElement("div");
    tag.className = "o3-tag";
    const name = document.createElement("span");
    name.className = `o3-name${this.lead ? " o3-lead" : ""}`;
    name.textContent = displayName;
    const gauge = document.createElement("div");
    gauge.className = "o3-gauge";
    gauge.style.display = "none";
    const bar = document.createElement("span");
    bar.className = "o3-gauge-bar";
    const gaugeFill = document.createElement("span");
    bar.append(gaugeFill);
    const gaugeText = document.createElement("span");
    gaugeText.className = "o3-gauge-text";
    gauge.append(bar, gaugeText);
    tag.append(name, gauge);
    // stacked above the head: "!" badge, speech bubble, then name + context gauge right over the head
    box.append(badge, bubble, zzz, tag);
    this.el = { bubble, badge, zzz, tag, gauge, gaugeFill, gaugeText };
    this.label = new CSS2DObject(box);
    this.label.center.set(0.5, 1);
    this.label.position.y = 0.78;
    this.root.add(this.label);

    if (walkIn) {
      // arrive by elevator, walk the corridor, come in through the door
      this.path = pathFromDoor(home, this.lead, this.entry);
      const start = this.path.shift()!;
      this.root.position.set(start.x, 0, start.z);
      this.mode = "entering";
    } else {
      this.root.position.set(home.x, 0, home.z);
      this.mode = "seated";
    }
  }

  get leaving() {
    return this.mode === "leaving" || this.mode === "gone";
  }

  get done() {
    return this.mode === "gone";
  }

  moveHome(home: Point, deskYaw: number | undefined) {
    this.deskYaw = deskYaw;
    if (home.x === this.home.x && home.z === this.home.z) return;
    this.home = home;
    if (this.mode === "seated") {
      this.path = pathBetween(this.pos(), home, this.lead);
      this.mode = "entering";
    }
  }

  leave() {
    if (this.leaving) return;
    this.path = pathToDoor(this.pos(), this.lead, this.entry);
    this.mode = "leaving";
  }

  private pos(): Point {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  /**
   * `shown` false when the room is hidden: CSS2D labels only honour their own visibility, not their parents'.
   * `clock` is the time the agent's state is judged at (the replay time during a replay); `now` drives the motion.
   */
  update(dtMs: number, now: number, detail: Detail, shown: boolean, clock = now) {
    const walking = this.step(dtMs);
    const status = visualStatus(this.agent, clock);
    const seated = this.mode === "seated" && this.deskYaw !== undefined;

    if (walking) {
      this.play("walk", "walk");
    } else if (seated) {
      const upper =
        status === "writing" || status === "running"
          ? "interact-right"
          : status === "done" && clock - this.agent.since < STRETCH_MS
            ? "emote-yes"
            : "idle";
      this.play("sit", upper);
      // Sitters face their desk: the unit's -z, i.e. unit yaw + π for a model that faces +z.
      this.root.rotation.y = this.deskYaw! + Math.PI;
      this.model.position.set(0, 0, SIT_BACK);
    } else {
      this.play("static", "idle");
      this.model.position.set(0, 0, 0);
      if (this.mode === "seated") this.root.rotation.y = 0;
    }
    this.mixer.update(dtMs / 1000);
    this.pose(status, now, walking);

    // status ring and labels
    this.ring.visible = !this.leaving;
    this.ring.material.color.setHex(RING_COLOR[status]);
    const pulse = status === "waiting" ? 1 + 0.15 * Math.sin(now / 140) : 1;
    this.ring.scale.setScalar(pulse);

    const showUi = shown && !this.leaving;
    const talk = detail === "full" || (detail === "summary" && (this.lead || status === "waiting"));
    const text = showUi && talk && !walking ? bubbleText(this.agent, status, clock, now) : undefined;
    const cls = `o3-bubble o3-${status}${text ? "" : " o3-hidden"}`;
    if (text !== undefined && text !== this.shown.bubble) {
      this.el.bubble.textContent = text.length > 26 ? `${text.slice(0, 25)}…` : text;
      this.shown.bubble = text;
    }
    if (cls !== this.shown.cls) {
      this.el.bubble.className = cls;
      this.shown.cls = cls;
    }
    this.el.badge.style.display = showUi && status === "waiting" && !walking ? "" : "none";
    this.el.zzz.style.display = showUi && status === "idle" && !walking && seated ? "" : "none";
    this.label.visible = showUi;
    const tagged = detail === "full" || (detail === "summary" && this.lead);
    this.el.tag.style.display = tagged ? "" : "none";
    this.renderGauge();
  }

  private renderGauge() {
    const g = this.gauge;
    const key = g ? `${gaugeLabel(g)}|${gaugeLevel(g)}|${Math.min(100, g.pct).toFixed(1)}` : "";
    if (key === this.shownGauge) return;
    this.shownGauge = key;
    this.el.gauge.style.display = g ? "" : "none";
    if (!g) return;
    this.el.gauge.className = `o3-gauge o3-gauge-${gaugeLevel(g)}`;
    this.el.gaugeFill.style.width = `${Math.min(100, g.pct)}%`;
    this.el.gaugeText.textContent = gaugeLabel(g);
    this.el.gauge.title = `컨텍스트 ${g.tokens.toLocaleString()} / ${g.limit.toLocaleString()} 토큰 (${g.model})${g.verified ? "" : " · 한도 미확인: 설정 파일에서 바꿀 수 있음"}`;
  }

  /** Bone tweaks layered on top of the clips. */
  private pose(status: AgentStatus, now: number, walking: boolean) {
    if (walking) return;
    const { head, armRight } = this.bones;
    if (status === "waiting" && armRight) {
      // raise the right hand and wave a little
      // Arm straight up (about x), tipped outward (+z for the right arm) so the big head doesn't hide it, waving.
      armRight.quaternion.copy(rotX(-2.9)).multiply(rotZ(0.35 + 0.2 * Math.sin(now / 150)));
    }
    if (head) {
      if (status === "reading") head.quaternion.multiply(rotX(0.28));
      if (status === "idle") head.quaternion.multiply(rotX(0.5 + 0.05 * Math.sin(now / 600)));
    }
  }

  private play(lower: string, upper: string) {
    this.swap("lower", lower === "walk" ? partClip(this.assets, "walk", "lower") : partClip(this.assets, lower, "lower"));
    this.swap("upper", partClip(this.assets, upper, "upper"));
  }

  private swap(slot: "lower" | "upper", clip: THREE.AnimationClip) {
    const current = this.playing[slot];
    if (current?.getClip() === clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (current) next.crossFadeFrom(current, 0.25, false);
    this.playing[slot] = next;
  }

  private step(dtMs: number): boolean {
    if (this.mode !== "entering" && this.mode !== "leaving") return false;
    let budget = (WALK_SPEED * dtMs) / 1000;
    const p = this.root.position;
    while (budget > 0 && this.path.length) {
      const target = this.path[0]!;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) this.root.rotation.y = Math.atan2(dx, dz);
      if (dist <= budget) {
        p.set(target.x, 0, target.z);
        this.path.shift();
        budget -= dist;
      } else {
        p.set(p.x + (dx / dist) * budget, 0, p.z + (dz / dist) * budget);
        budget = 0;
      }
    }
    if (!this.path.length) {
      // a leaver has reached the elevator and rides away
      this.mode = this.mode === "leaving" ? "gone" : "seated";
      return false;
    }
    return true;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.ring.material.dispose();
    this.root.removeFromParent();
    // CSS2D cleans up only the object removed itself, not labels nested under it
    this.label.element.remove();
  }
}
