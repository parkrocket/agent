"use client";

import { useEffect, useRef } from "react";
import type { OfficeScene, SceneInput } from "@/office/OfficeScene";

/** Hosts the Pixi office; only rendered on the client (see OfficeApp). */
export default function OfficeCanvas({ input, onOpenRoom }: { input: SceneInput; onOpenRoom: (key: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const openRef = useRef(onOpenRoom);
  openRef.current = onOpenRoom;

  useEffect(() => {
    let disposed = false;
    let scene: OfficeScene | null = null;
    // Pixi touches window/document, so it is imported lazily on the client.
    import("@/office/OfficeScene").then(async ({ OfficeScene }) => {
      const created = await OfficeScene.create(hostRef.current!, (key) => openRef.current(key));
      // React strict mode mounts twice in dev; drop the scene if we were unmounted meanwhile.
      if (disposed) return created.destroy();
      scene = created;
      sceneRef.current = created;
      created.sync(inputRef.current);
    });
    return () => {
      disposed = true;
      scene?.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.sync(input);
  }, [input]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
}
