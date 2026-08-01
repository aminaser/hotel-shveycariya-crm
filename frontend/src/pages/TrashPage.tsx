import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type GuestRequest, type SpaBooking } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";

interface CrmTrashItem {
  type: "stay" | "client" | "banquet" | "takeaway" | "guest_service";
  id: number;
  title: string;
  subtitle: string | null;
  deleted_at: string;
}

interface TrashEntry {
  key: string;
  kind: "crm" | "spa" | "request";
  type: string;
  typeLabel: string;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  crmItem?: CrmTrashItem;
  localId?: string;
}

const TYPE_LABEL: Record<string, string> = {
  stay: "Журнал",
  client: "Клиенты",
  banquet: "Банкеты",
  takeaway: "На вынос",
  guest_service: "Услуги для гостей",
  spa: "Сауна / баня",
  request: "Заявки",
};

const SPA_SERVICE_LABEL: Record<string, string> = {
  sauna: "Финская сауна",
  banya: "Русская баня",
};

async function fetchSpaTrash(): Promise<SpaBooking[]> {
  return apiFetch<SpaBooking[]>("/spa-bookings?deleted_only=true");
}

async function fetchRequestsTrash(): Promise<GuestRequest[]> {
  return apiFetch<GuestRequest[]>("/guest-requests?deleted_only=true");
}

async function restoreLocalRow(kind: "spa" | "request", id: string) {
  if (kind === "spa") {
    await apiFetch(`/spa-bookings/${id}/restore`, { method: "POST" });
    try {
      await apiFetch(`/spa-payments/${id}/restore`, { method: "POST" });
    } catch {
      // Payment row may not exist for older bookings.
    }
    return;
  }
  await apiFetch(`/guest-requests/${id}/restore`, { method: "POST" });
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

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

export function TrashPage() {
  const queryClient = useQueryClient();
  const isOwner = useAuthStore((s) => s.isOwner());

  const { data: crmTrash = [], isLoading: crmLoading } = useQuery({
    queryKey: ["crm-trash"],
    queryFn: () => apiFetch<CrmTrashItem[]>("/trash"),
    refetchInterval: 30_000,
  });

  const { data: spaTrash = [], isLoading: spaLoading } = useQuery({
    queryKey: ["spa-bookings-trash"],
    queryFn: fetchSpaTrash,
    refetchInterval: 30_000,
  });

  const { data: requestsTrash = [], isLoading: requestsLoading } = useQuery({
    queryKey: ["requests-trash"],
    queryFn: fetchRequestsTrash,
    refetchInterval: 30_000,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["crm-trash"] });
    void queryClient.invalidateQueries({ queryKey: ["spa-bookings-trash"] });
    void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
    void queryClient.invalidateQueries({ queryKey: ["requests-trash"] });
    void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["stays"] });
    void queryClient.invalidateQueries({ queryKey: ["stays-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
    void queryClient.invalidateQueries({ queryKey: ["banquets"] });
    void queryClient.invalidateQueries({ queryKey: ["takeaway-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["guest-services"] });
    void queryClient.invalidateQueries({ queryKey: ["rooms"] });
  };

  const restoreCrm = useMutation({
    mutationFn: (item: CrmTrashItem) =>
      apiFetch("/trash/restore", {
        method: "POST",
        body: JSON.stringify({ type: item.type, id: item.id }),
      }),
    onSuccess: () => {
      toast.success("Запись восстановлена");
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось восстановить запись");
    },
  });

  const restoreLocal = useMutation({
    mutationFn: ({ kind, id }: { kind: "spa" | "request"; id: string }) =>
      restoreLocalRow(kind, id),
    onSuccess: () => {
      toast.success("Запись восстановлена");
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearTrash = useMutation({
    mutationFn: async () => {
      const failures: string[] = [];

      try {
        await apiFetch("/trash/clear", { method: "DELETE" });
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "ошибка CRM";
        failures.push(`Журнал/клиенты/банкеты: ${msg}`);
      }

      try {
        await apiFetch("/spa-bookings/trash", { method: "DELETE" });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "ошибка";
        failures.push(`Сауна/баня: ${msg}`);
      }

      try {
        await apiFetch("/guest-requests/trash", { method: "DELETE" });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "ошибка";
        failures.push(`Заявки: ${msg}`);
      }

      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }
    },
    onSuccess: () => {
      toast.success("Корзина очищена полностью");
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else if (e instanceof Error) toast.error(e.message);
      else toast.error("Не удалось очистить корзину");
      invalidateAll();
    },
  });

  const trashCount = crmTrash.length + spaTrash.length + requestsTrash.length;

  const entries: TrashEntry[] = [
    ...crmTrash.map((item): TrashEntry => ({
      key: `crm-${item.type}-${item.id}`,
      kind: "crm",
      type: item.type,
      typeLabel: TYPE_LABEL[item.type] ?? item.type,
      title: item.title,
      subtitle: item.subtitle,
      deletedAt: item.deleted_at,
      crmItem: item,
    })),
    ...spaTrash.map((booking): TrashEntry => ({
      key: `spa-${booking.id}`,
      kind: "spa",
      type: "spa",
      typeLabel: TYPE_LABEL.spa,
      title: `${SPA_SERVICE_LABEL[booking.service] ?? booking.service}: ${booking.guest_name}`,
      subtitle: `${formatDate(booking.booking_date)} · ${booking.slot_time}${
        booking.room ? ` · номер ${booking.room}` : ""
      }`,
      deletedAt: booking.deleted_at as string,
      localId: booking.id,
    })),
    ...requestsTrash.map((request): TrashEntry => ({
      key: `request-${request.id}`,
      kind: "request",
      type: "request",
      typeLabel: TYPE_LABEL.request,
      title: `Заявка: ${request.title ?? request.type}`,
      subtitle: [
        request.guest_name,
        request.room ? `номер ${request.room}` : null,
        formatDateTime(request.created_at),
      ]
        .filter(Boolean)
        .join(" · "),
      deletedAt: request.deleted_at as string,
      localId: request.id,
    })),
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  const isLoading = crmLoading || spaLoading || requestsLoading;
  const restorePending = restoreCrm.isPending || restoreLocal.isPending;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Trash2 className="h-6 w-6" />
            Корзина
          </h1>
          <p className="text-sm text-muted-foreground">
            Удалённые записи из всех разделов CRM. Их можно восстановить
            {isOwner ? " или очистить корзину целиком навсегда." : "."}
          </p>
        </div>
        {isOwner && trashCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600"
            disabled={clearTrash.isPending}
            onClick={() => {
              if (
                confirm(
                  `Очистить всю корзину навсегда (${trashCount} записей)? Это действие нельзя отменить.`,
                )
              ) {
                clearTrash.mutate();
              }
            }}
          >
            {clearTrash.isPending ? "Очистка…" : "Очистить всю корзину"}
          </Button>
        )}
      </div>

      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}

      {!isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Корзина пуста. Сюда попадают удалённые записи журнала, клиентов, банкетов,
            заявок и сауны/бани.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {entries.map((entry) => (
          <Card key={entry.key} className="opacity-90">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{entry.typeLabel}</Badge>
                  <span className="font-medium">{entry.title}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {entry.subtitle ? `${entry.subtitle} · ` : ""}
                  Удалено: {formatDateTime(entry.deletedAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={restorePending}
                onClick={() => {
                  if (entry.kind === "crm" && entry.crmItem) {
                    restoreCrm.mutate(entry.crmItem);
                  } else if (entry.localId) {
                    restoreLocal.mutate({
                      kind: entry.kind === "spa" ? "spa" : "request",
                      id: entry.localId,
                    });
                  }
                }}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Восстановить
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
