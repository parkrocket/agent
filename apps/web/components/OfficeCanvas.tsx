"use client";

import { useEffect, useRef } from "react";
import type { SessionState } from "@ai-office/shared";
import type { OfficeScene } from "@/office/OfficeScene";

/** Hosts the Pixi office; only rendered on the client (see page.tsx). */
export default function OfficeCanvas({ session }: { session: SessionState | undefined }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    let disposed = false;
    let scene: OfficeScene | null = null;
    // Pixi touches window/document, so it is imported lazily on the client.
    import("@/office/OfficeScene").then(async ({ OfficeScene }) => {
      const created = await OfficeScene.create(hostRef.current!);
      // React strict mode mounts twice in dev; drop the scene if we were unmounted meanwhile.
      if (disposed) return created.destroy();
      scene = created;
      sceneRef.current = created;
      created.sync(sessionRef.current);
    });
    return () => {
      disposed = true;
      scene?.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.sync(session);
  }, [session]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
}
