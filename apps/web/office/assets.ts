// Loads the CC0 Kenney models (public/assets/kenney, see License.txt there)
// once, and hands out clones. Furniture is re-centred so every model's
// footprint is centred on its origin with its base at y = 0, which makes
// placing and rotating it on the floor grid straightforward.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const BASE = "/assets/kenney";

export const FURNITURE = [
  "desk",
  "chairDesk",
  "computerScreen",
  "computerKeyboard",
  "computerMouse",
  "wall",
  "wallWindow",
  "wallDoorway",
  "bookcaseOpen",
  "pottedPlant",
  "plantSmall1",
  "rugRectangle",
  "kitchenCoffeeMachine",
  "lampRoundFloor",
  "trashcan",
  "coatRackStanding",
  "sideTable",
] as const;
export type FurnitureName = (typeof FURNITURE)[number];

export const CHARACTERS = [
  "male-a",
  "male-b",
  "male-c",
  "male-d",
  "male-e",
  "male-f",
  "female-a",
  "female-b",
  "female-c",
  "female-d",
  "female-e",
  "female-f",
] as const;
export type CharacterName = (typeof CHARACTERS)[number];

export interface Assets {
  furniture: Record<FurnitureName, THREE.Object3D>;
  /** Footprint size (x, z) and height of each re-centred model. */
  size: Record<FurnitureName, THREE.Vector3>;
  characters: Record<CharacterName, THREE.Object3D>;
  /** Shared clips; every character uses the same rig (root, legs, torso, arms, head). */
  clips: Record<string, THREE.AnimationClip>;
}

let loading: Promise<Assets> | undefined;

/** Loads everything once; later calls share the same promise. */
export function loadAssets(): Promise<Assets> {
  loading ??= load();
  return loading;
}

async function load(): Promise<Assets> {
  const loader = new GLTFLoader();
  const get = (url: string) => loader.loadAsync(url);

  const furnitureEntries = await Promise.all(
    FURNITURE.map(async (name) => [name, await get(`${BASE}/furniture/${name}.glb`)] as const),
  );
  const furniture = {} as Record<FurnitureName, THREE.Object3D>;
  const size = {} as Record<FurnitureName, THREE.Vector3>;
  for (const [name, gltf] of furnitureEntries) {
    const { object, dims } = recentre(gltf.scene);
    furniture[name] = object;
    size[name] = dims;
  }

  const characterEntries = await Promise.all(
    CHARACTERS.map(async (name) => [name, await get(`${BASE}/characters/character-${name}.glb`)] as const),
  );
  const characters = {} as Record<CharacterName, THREE.Object3D>;
  let clips: Record<string, THREE.AnimationClip> = {};
  for (const [name, gltf] of characterEntries) {
    prepare(gltf.scene);
    characters[name] = gltf.scene;
    if (!Object.keys(clips).length) clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  }
  return { furniture, size, characters, clips };
}

function prepare(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

function recentre(scene: GLTF["scene"]) {
  prepare(scene);
  const box = new THREE.Box3().setFromObject(scene);
  const centre = box.getCenter(new THREE.Vector3());
  scene.position.set(-centre.x, -box.min.y, -centre.z);
  const object = new THREE.Group();
  object.add(scene);
  return { object, dims: box.getSize(new THREE.Vector3()) };
}

/**
 * Furniture clone. Geometry is shared; materials are shared per `materials`
 * map so one room can tint its own copies (lights off) without touching others.
 */
export function cloneFurniture(assets: Assets, name: FurnitureName, materials: Map<THREE.Material, THREE.Material>) {
  const object = assets.furniture[name].clone(true);
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      let copy = materials.get(m);
      if (!copy) {
        copy = m.clone();
        materials.set(m, copy);
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return object;
}

/** Skinned characters need SkeletonUtils so each clone gets its own skeleton. */
export function cloneCharacter(assets: Assets, name: CharacterName): THREE.Object3D {
  return SkeletonUtils.clone(assets.characters[name]);
}

const UPPER = ["torso", "arm-left", "arm-right", "head"];
const LOWER = ["root", "leg-left", "leg-right"];

const filtered = new Map<string, THREE.AnimationClip>();

/** A clip restricted to the upper or lower body, so a seated pose can be layered with arm/head motion. */
export function partClip(assets: Assets, name: string, part: "upper" | "lower" | "full"): THREE.AnimationClip {
  const clip = assets.clips[name];
  if (!clip) throw new Error(`missing animation ${name}`);
  if (part === "full") return clip;
  const key = `${name}:${part}`;
  let out = filtered.get(key);
  if (!out) {
    const bones = part === "upper" ? UPPER : LOWER;
    out = new THREE.AnimationClip(
      key,
      clip.duration,
      clip.tracks.filter((t) => bones.includes(t.name.split(".")[0]!)),
    );
    filtered.set(key, out);
  }
  return out;
}
