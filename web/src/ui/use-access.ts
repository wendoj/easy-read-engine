import { useEffect, useState } from "react";
import type { AccessState } from "@/src/access/errors";
import { getAccess } from "./api";

/** Null until `/api/access` answers, or when it can't be reached. */
export function useAccess() {
  const [access, setAccess] = useState<AccessState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getAccess({ signal: controller.signal }).then((outcome) => {
      if (outcome.ok) setAccess(outcome.access);
    });
    return () => controller.abort();
  }, []);
  return [access, setAccess] as const;
}
