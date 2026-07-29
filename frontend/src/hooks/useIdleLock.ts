import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/api/client";
import { useAuthStore } from "@/stores/auth";

export function useIdleLock() {
  const locked = useAuthStore((s) => s.locked);
  const lock = useAuthStore((s) => s.lock);
  const touch = useAuthStore((s) => s.touch);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<{ auto_lock_minutes: number }>("/settings"),
  });

  useEffect(() => {
    const minutes = settings?.auto_lock_minutes ?? 15;
    if (minutes <= 0 || locked) return;

    const timeoutMs = minutes * 60 * 1000;
    let timer = window.setTimeout(() => lock(), timeoutMs);

    const onActivity = () => {
      window.clearTimeout(timer);
      touch();
      timer = window.setTimeout(() => lock(), timeoutMs);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, onActivity));

    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, onActivity));
    };
  }, [settings?.auto_lock_minutes, touch, lock, locked]);

  return locked;
}
