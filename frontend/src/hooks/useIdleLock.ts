import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch } from "@/api/client";
import { useAuthStore } from "@/stores/auth";

export function useIdleLock() {
  const [locked, setLocked] = useState(false);
  const touch = useAuthStore((s) => s.touch);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<{ auto_lock_minutes: number }>("/settings"),
  });

  useEffect(() => {
    const minutes = settings?.auto_lock_minutes ?? 15;
    const timeoutMs = minutes * 60 * 1000;

    let timer = window.setTimeout(() => setLocked(true), timeoutMs);

    const onActivity = () => {
      window.clearTimeout(timer);
      touch();
      setLocked(false);
      timer = window.setTimeout(() => setLocked(true), timeoutMs);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, onActivity));

    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, onActivity));
    };
  }, [settings?.auto_lock_minutes, touch]);

  return locked;
}
