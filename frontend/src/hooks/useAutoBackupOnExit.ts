import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiFetch, apiUrl } from "@/api/client";
import type { AppSettings } from "@/api/types";
import { useAuthStore } from "@/stores/auth";

export function useAutoBackupOnExit() {
  const token = useAuthStore((s) => s.token);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<AppSettings>("/settings"),
    enabled: !!token,
  });

  useEffect(() => {
    if (!token || !settings?.auto_backup_on_exit) return;

    const onExit = () => {
      fetch(apiUrl("/settings/backup"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        keepalive: true,
      });
    };

    window.addEventListener("beforeunload", onExit);
    return () => window.removeEventListener("beforeunload", onExit);
  }, [token, settings?.auto_backup_on_exit]);
}
