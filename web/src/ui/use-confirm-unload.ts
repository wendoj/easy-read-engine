import { useEffect } from "react";

/** The user's own letter can't come back after a reload, so the browser asks first while `active`. */
export function useConfirmUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
