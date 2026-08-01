import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import { AuthorFilter } from "@/components/AuthorFilter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth";

interface ActivityLog {
  id: number;
  created_at: string;
  user_id: number | null;
  user_name: string;
  user_role: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  old_value: string | null;
  new_value: string | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityPage() {
  const isOwner = useAuthStore((s) => s.user?.role === "owner");
  const queryClient = useQueryClient();
  const [authorId, setAuthorId] = useState<number | null>(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["activity", authorId],
    queryFn: () => {
      const qs = authorId != null ? `?user_id=${authorId}&limit=500` : "?limit=500";
      return apiFetch<ActivityLog[]>(`/activity${qs}`);
    },
    refetchInterval: 15_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => apiFetch("/activity", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Журнал действий очищен");
      void queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ScrollText className="h-6 w-6" />
            Журнал действий
          </h1>
          <p className="text-sm text-muted-foreground">
            Все действия пользователей CRM: вход, выход, создание и изменение записей.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600"
              disabled={clearMutation.isPending || logs.length === 0}
              onClick={() => {
                if (confirm("Очистить весь журнал действий? Это действие нельзя отменить.")) {
                  clearMutation.mutate();
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Очистить журнал
            </Button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}

      {!isLoading && logs.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Записей пока нет.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {logs.map((log) => (
          <Card key={log.id}>
            <CardContent className="space-y-1 py-4 text-sm">
              <div className="font-medium">{formatDateTime(log.created_at)}</div>
              <div>
                Пользователь: <span className="font-medium">{log.user_name}</span>
              </div>
              <div>Роль: {log.user_role}</div>
              <div>Действие: {log.action}</div>
              {log.entity_label && <div>{log.entity_label}</div>}
              {log.old_value && (
                <div className="text-muted-foreground">Было: {log.old_value}</div>
              )}
              {log.new_value && (
                <div className="text-muted-foreground">Стало: {log.new_value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
