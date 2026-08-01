import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { logClientActivity } from "@/lib/activity";
import { type GuestRequest, type RequestStage, supabase } from "@/lib/supabase";

const STAGE_LABEL: Record<RequestStage, string> = {
  received: "Новая",
  assigned: "Принята",
  in_progress: "В работе",
  done: "Завершена",
};

const STAGE_VARIANT: Record<RequestStage, "default" | "muted" | "warning" | "danger"> = {
  received: "danger",
  assigned: "warning",
  in_progress: "default",
  done: "muted",
};

const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;

function isArchived(request: GuestRequest): boolean {
  if (request.stage !== "done") return false;
  return Date.now() - new Date(request.updated_at).getTime() > ARCHIVE_AFTER_MS;
}

async function fetchRequests(): Promise<GuestRequest[]> {
  return apiFetch<GuestRequest[]>("/guest-requests");
}

async function softDeleteRequest(id: string) {
  await apiFetch(`/guest-requests/${id}`, { method: "DELETE" });
}

async function updateStage(id: string, stage: RequestStage) {
  await apiFetch(`/guest-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ stage }),
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getActionButtons(request: GuestRequest): { label: string; stage: RequestStage }[] {
  const { type, stage } = request;

  if (type === "housekeeping") {
    if (stage === "received") return [{ label: "Принять заявку", stage: "assigned" }];
    if (stage === "assigned") return [{ label: "Уборка выполнена", stage: "done" }];
    return [];
  }

  if (type === "sauna" || type === "banya") {
    if (stage === "received") return [{ label: "Подтвердить бронь", stage: "assigned" }];
    if (stage === "assigned") return [{ label: "Завершить", stage: "done" }];
    return [];
  }

  if (stage === "received") return [{ label: "Принять", stage: "assigned" }];
  if (stage === "assigned") return [{ label: "В работу", stage: "in_progress" }];
  if (stage === "in_progress") return [{ label: "Завершить", stage: "done" }];
  return [];
}

export function RequestsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "archive" | RequestStage>("all");

  const { data: requests = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["guest-requests"],
    queryFn: fetchRequests,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("crm-requests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "requests" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
        },
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient]);

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: RequestStage }) =>
      updateStage(id, stage),
    onSuccess: (_data, vars) => {
      toast.success("Статус обновлён");
      void logClientActivity({
        action: "Обновила статус заявки",
        entity_type: "request",
        entity_id: vars.id,
        new_value: vars.stage,
      });
      void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDeleteRequest(id),
    onSuccess: (_data, id) => {
      toast.success("Заявка перемещена в корзину");
      void logClientActivity({
        action: "Удалила заявку",
        entity_type: "request",
        entity_id: id,
      });
      void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["requests-trash"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const archived = requests.filter(isArchived);
  const current = requests.filter((r) => !isArchived(r));
  const filtered =
    filter === "archive"
      ? archived
      : filter === "all"
        ? current
        : current.filter((r) => r.stage === filter);
  const activeCount = current.filter((r) => r.stage !== "done").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Заявки</h1>
          <p className="text-sm text-muted-foreground">
            Запросы из чат-бота · активных: {activeCount}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "received", "assigned", "in_progress", "done", "archive"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? "Все" : key === "archive" ? "Архив" : STAGE_LABEL[key]}
            {key !== "all" && (
              <span className="ml-1.5 text-xs opacity-70">
                (
                {key === "archive"
                  ? archived.length
                  : current.filter((r) => r.stage === key).length}
                )
              </span>
            )}
          </Button>
        ))}
      </div>

      {isError && (
        <Card>
          <CardContent className="py-6 text-destructive">
            Ошибка загрузки: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isError && (isLoading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {filter === "archive"
              ? "Архив пуст. Заявки попадают сюда автоматически через 24 часа."
              : "Нет заявок. Создайте запрос в чат-боте (уборка или сауна)."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map((request) => {
            const actions = getActionButtons(request);
            return (
              <Card key={request.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">
                        {request.title ?? request.type}
                        {request.room && (
                          <span className="ml-2 text-base font-normal text-muted-foreground">
                            · № {request.room}
                          </span>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {request.guest_name ?? "Гость"} · {formatTime(request.created_at)}
                      </p>
                    </div>
                    <Badge variant={STAGE_VARIANT[request.stage]}>{STAGE_LABEL[request.stage]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {request.description && (
                    <p className="text-sm">{request.description}</p>
                  )}
                  <AuthorshipMeta
                    createdByName={request.created_by_name}
                    createdAt={request.created_at}
                    updatedByName={request.updated_by_name ?? request.confirmed_by_name}
                    updatedAt={request.updated_at}
                  />
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Тип: {request.type}</span>
                    {request.language && <span>· Язык: {request.language}</span>}
                    <span>· ID: {request.id.slice(0, 8).toUpperCase()}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {actions.map((action) => (
                      <Button
                        key={action.stage}
                        size="sm"
                        disabled={stageMutation.isPending}
                        onClick={() => stageMutation.mutate({ id: request.id, stage: action.stage })}
                      >
                        {action.label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(request.id)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Удалить
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
    </div>
  );
}
