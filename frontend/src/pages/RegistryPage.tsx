import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { Client, RegistrySummary, Room, Stay, StayType, PaymentStatus } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { ClientProfileSheet } from "@/components/ClientProfileSheet";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isActiveStay, isCheckoutToday, nightsBetween, stayAmountFromRate, todayLocal } from "@/lib/dates";
import {
  copyToClipboard,
  csvEscape,
  formatDate,
  formatMoney,
  paymentStatusLabel,
  roomStatusLabel,
  stayTypeLabel,
} from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
} from "@/lib/payment-method";

type Filter = "all" | "today" | "week" | "unpaid" | "active" | "checkout_today";
type PaymentFilter = "all" | "cash" | "kaspi" | "halyk" | "other";

const emptyForm = () => ({
  client_id: "",
  room_id: "",
  record_date: todayLocal(),
  stay_type: "booking" as StayType,
  check_in: todayLocal(),
  planned_check_out: "",
  payment_amount: "",
  payment_status: "unpaid" as PaymentStatus,
  payment_method_preset: "cash",
  payment_method_custom: "",
  phone: "",
  notes: "",
});

function mutationError(error: unknown, fallback: string) {
  if (error instanceof ApiError) toast.error(error.message);
  else toast.error(fallback);
}

export function RegistryPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editStay, setEditStay] = useState<Stay | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [form, setForm] = useState(emptyForm);

  const resetForm = () => {
    setForm(emptyForm());
    setNewClientName("");
  };

  const openEdit = (stay: Stay) => {
    const { preset, customText } = splitPaymentMethod(stay.payment_method);
    setEditStay(stay);
    setForm({
      client_id: String(stay.client_id),
      room_id: String(stay.room_id),
      record_date: stay.record_date,
      stay_type: stay.stay_type,
      check_in: stay.check_in ?? stay.record_date,
      planned_check_out: stay.planned_check_out ?? "",
      payment_amount: stay.payment_amount,
      payment_status: stay.payment_status,
      payment_method_preset: preset,
      payment_method_custom: customText,
      phone: stay.client_phone ?? "",
      notes: stay.notes ?? "",
    });
    setDialogOpen(true);
  };

  const filterParam = filter === "all" ? "" : filter;
  const paymentFilterParam = paymentFilter === "all" ? "" : paymentFilter;
  const { data: stays = [], isLoading } = useQuery({
    queryKey: ["stays", filter, paymentFilter, search, dateFrom, dateTo, authorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterParam) params.set("filter", filterParam);
      if (paymentFilterParam) params.set("payment_method", paymentFilterParam);
      if (search) params.set("search", search);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (authorId != null) params.set("author_id", String(authorId));
      const qs = params.toString();
      return apiFetch<Stay[]>(`/stays${qs ? `?${qs}` : ""}`);
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["stays-summary"],
    queryFn: () => apiFetch<RegistrySummary>("/stays/summary"),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
  });

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiFetch<Room[]>("/rooms"),
  });

  const applyRoomRate = (
    next: ReturnType<typeof emptyForm>,
    roomId: string,
    checkIn: string,
    checkOut: string,
  ) => {
    const room = rooms.find((r) => String(r.id) === roomId);
    if (!room?.price_per_night) return next;
    return {
      ...next,
      payment_amount: stayAmountFromRate(room.price_per_night, checkIn, checkOut || null),
    };
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["stays"] });
    queryClient.invalidateQueries({ queryKey: ["stays-summary"] });
    queryClient.invalidateQueries({ queryKey: ["rooms"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  const syncClientPhone = async (clientId: number) => {
    const existing = clients.find((c) => c.id === clientId);
    if (existing && form.phone !== (existing.phone ?? "")) {
      await apiFetch(`/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ phone: form.phone || null }),
      });
    }
  };

  const buildStayPayload = (clientId: number) => ({
    client_id: clientId,
    room_id: parseInt(form.room_id, 10),
    record_date: form.record_date,
    stay_type: form.stay_type,
    check_in: form.check_in || null,
    planned_check_out: form.planned_check_out || null,
    payment_amount: form.payment_amount || "0",
    payment_status: form.payment_status,
    payment_method: resolvePaymentMethod(
      form.payment_method_preset,
      form.payment_method_custom,
    ),
    notes: form.notes || null,
  });

  const validateForm = (): boolean => {
    if (!form.room_id) {
      toast.error("Выберите номер комнаты");
      return false;
    }
    if (!editStay && !form.client_id && !newClientName.trim()) {
      toast.error("Выберите клиента или введите ФИО");
      return false;
    }
    if (
      form.planned_check_out &&
      form.check_in &&
      form.planned_check_out < form.check_in
    ) {
      toast.error("Дата выезда не может быть раньше заезда");
      return false;
    }
    return true;
  };

  const createStay = useMutation({
    mutationFn: async () => {
      if (!validateForm()) throw new Error("validation");

      let clientId = form.client_id ? parseInt(form.client_id, 10) : null;
      if (!clientId && newClientName.trim()) {
        const client = await apiFetch<Client>("/clients", {
          method: "POST",
          body: JSON.stringify({
            full_name: newClientName.trim(),
            phone: form.phone || null,
          }),
        });
        clientId = client.id;
      }
      if (!clientId) throw new Error("Выберите или создайте клиента");

      await syncClientPhone(clientId);
      return apiFetch("/stays", {
        method: "POST",
        body: JSON.stringify(buildStayPayload(clientId)),
      });
    },
    onSuccess: () => {
      toast.success("Запись добавлена");
      setDialogOpen(false);
      setEditStay(null);
      resetForm();
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось добавить запись");
    },
  });

  const updateStay = useMutation({
    mutationFn: async () => {
      if (!editStay) throw new Error("Нет записи");
      if (!validateForm()) throw new Error("validation");

      const clientId = parseInt(form.client_id, 10);
      await syncClientPhone(clientId);
      return apiFetch(`/stays/${editStay.id}`, {
        method: "PATCH",
        body: JSON.stringify(buildStayPayload(clientId)),
      });
    },
    onSuccess: () => {
      toast.success("Запись обновлена");
      setDialogOpen(false);
      setEditStay(null);
      resetForm();
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось обновить запись");
    },
  });

  const deleteStay = useMutation({
    mutationFn: (id: number) => apiFetch(`/stays/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Запись удалена");
      invalidateAll();
    },
    onError: (e) => mutationError(e, "Не удалось удалить запись"),
  });

  const checkoutStay = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/stays/${id}/checkout`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Выезд оформлен, номер на уборку");
      invalidateAll();
    },
    onError: (e) => mutationError(e, "Не удалось оформить выезд"),
  });

  const exportCsv = () => {
    const header = "Дата,ФИО,Комната,Тип,Заезд,Выезд,Сумма,Статус,Способ оплаты,Телефон\n";
    const rows = stays
      .map((s) =>
        [
          s.record_date,
          csvEscape(s.client_name),
          s.room_number,
          stayTypeLabel[s.stay_type],
          s.check_in ?? "",
          s.planned_check_out ?? "",
          s.payment_amount,
          paymentStatusLabel[s.payment_status],
          csvEscape(formatPaymentMethod(s.payment_method)),
          s.client_phone ?? "",
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal_${todayLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPhone = async (phone: string | null) => {
    if (!phone) return;
    const ok = await copyToClipboard(phone);
    if (ok) toast.success("Телефон скопирован");
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Журнал заселений</h1>
          <p className="text-sm text-muted-foreground">Основной рабочий экран</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            Экспорт CSV
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setEditStay(null);
              setDialogOpen(true);
            }}
          >
            + Новая запись
          </Button>
        </div>
      </div>

      {summary && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Заселения сегодня", value: summary.today_checkins },
              { label: "Выручка сегодня", value: formatMoney(summary.today_payments_kzt) },
              { label: "Выезды сегодня", value: summary.today_checkouts },
              { label: "Занято номеров", value: `${summary.occupied_rooms}/${summary.total_rooms}` },
              { label: "Всего записей", value: summary.total_records },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Касса за сегодня (оплачено)
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Наличка: {formatMoney(summary.payments_by_method.cash)}</span>
              <span>Kaspi: {formatMoney(summary.payments_by_method.kaspi)}</span>
              <span>Halyk: {formatMoney(summary.payments_by_method.halyk)}</span>
              <span>Другое: {formatMoney(summary.payments_by_method.other)}</span>
            </div>
          </div>
        </>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "Все"],
            ["today", "Сегодня"],
            ["week", "Эта неделя"],
            ["active", "В номере"],
            ["checkout_today", "Выезд сегодня"],
            ["unpaid", "Неоплаченные"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
        <Input
          className="max-w-[140px]"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Дата с"
        />
        <Input
          className="max-w-[140px]"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Дата по"
        />
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            Сбросить даты
          </Button>
        )}
        <AuthorFilter value={authorId} onChange={setAuthorId} />
        <Input
          className="max-w-xs"
          placeholder="Поиск ФИО, телефон, комната..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={paymentFilter}
          onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Способ оплаты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все способы</SelectItem>
            <SelectItem value="cash">Наличка</SelectItem>
            <SelectItem value="kaspi">Kaspi</SelectItem>
            <SelectItem value="halyk">Halyk</SelectItem>
            <SelectItem value="other">Свой вариант</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Дата</th>
              <th className="px-4 py-3 text-left font-medium">ФИО</th>
              <th className="px-4 py-3 text-left font-medium">№ комнаты</th>
              <th className="px-4 py-3 text-left font-medium">Тип</th>
              <th className="px-4 py-3 text-left font-medium">Заезд / Выезд</th>
              <th className="px-4 py-3 text-left font-medium">Оплата</th>
              <th className="px-4 py-3 text-left font-medium">Способ</th>
              <th className="px-4 py-3 text-left font-medium">Телефон</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Загрузка...
                </td>
              </tr>
            ) : stays.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Нет записей
                </td>
              </tr>
            ) : (
              stays.map((stay) => (
                <tr key={stay.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div>{formatDate(stay.record_date)}</div>
                    {isActiveStay(stay.check_out) && (
                      <Badge variant="warning" className="mt-1 text-[10px]">
                        В номере
                      </Badge>
                    )}
                    {isActiveStay(stay.check_out) &&
                      isCheckoutToday(stay.planned_check_out) && (
                      <Badge variant="default" className="mt-1 text-[10px]">
                        Выезд сегодня
                      </Badge>
                    )}
                    {!isActiveStay(stay.check_out) && (
                      <Badge variant="muted" className="mt-1 text-[10px]">
                        Выехал
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setSelectedClientId(stay.client_id)}
                    >
                      {stay.client_name}
                    </button>
                    <AuthorshipMeta
                      className="mt-1"
                      createdByName={stay.created_by_name}
                      createdAt={stay.created_at}
                      updatedByName={stay.updated_by_name}
                      updatedAt={stay.updated_at}
                    />
                  </td>
                  <td className="px-4 py-3">{stay.room_number}</td>
                  <td className="px-4 py-3">
                    <Badge variant={stay.stay_type === "booking" ? "default" : "warning"}>
                      {stayTypeLabel[stay.stay_type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {stay.check_in ? formatDate(stay.check_in) : "—"}
                    {" → "}
                    {stay.planned_check_out
                      ? formatDate(stay.planned_check_out)
                      : "—"}
                    {stay.check_out
                      ? ` · оформлен ${formatDate(stay.check_out)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3">
                    <div>{formatMoney(stay.payment_amount)}</div>
                    <div className="text-xs text-muted-foreground">
                      {paymentStatusLabel[stay.payment_status]}
                    </div>
                  </td>
                  <td className="px-4 py-3">{formatPaymentMethod(stay.payment_method)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span>{stay.client_phone ?? "—"}</span>
                      {stay.client_phone && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => handleCopyPhone(stay.client_phone)}
                          title="Копировать телефон"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {isActiveStay(stay.check_out) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (confirm(`Оформить выезд: ${stay.client_name}?`)) {
                              checkoutStay.mutate(stay.id);
                            }
                          }}
                        >
                          Выезд
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(stay)}>
                        Изменить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Удалить запись?")) deleteStay.mutate(stay.id);
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientProfileSheet
        clientId={selectedClientId}
        onClose={() => setSelectedClientId(null)}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditStay(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editStay ? "Редактировать запись" : "Новая запись"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editStay ? (
              <>
                <div className="space-y-2">
                  <Label>Клиент</Label>
                  <Select
                    value={form.client_id}
                    onValueChange={(v) => {
                      const client = clients.find((c) => String(c.id) === v);
                      setForm({
                        ...form,
                        client_id: v,
                        phone: client?.phone ?? "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите клиента" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Или новый клиент (ФИО)</Label>
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    disabled={!!form.client_id}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{editStay.client_name}</div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+7 7xx xxx xx xx"
              />
            </div>
            <div className="space-y-2">
              <Label>Номер комнаты</Label>
              <Select
                value={form.room_id}
                onValueChange={(v) => {
                  const next = { ...form, room_id: v };
                  setForm(
                    applyRoomRate(next, v, next.check_in, next.planned_check_out),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите номер" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      №{r.number}
                      {r.price_per_night
                        ? ` · ${Number(r.price_per_night).toLocaleString("ru-KZ")} ₸/сут.`
                        : ""}
                      {r.room_type ? ` · ${r.room_type}` : ""}
                      {" · "}
                      {roomStatusLabel[r.status]}
                      {r.current_guest ? ` (${r.current_guest})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.room_id && (
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const room = rooms.find((r) => String(r.id) === form.room_id);
                    if (!room?.price_per_night) return "Цена за сутки не задана";
                    const nights = nightsBetween(
                      form.check_in,
                      form.planned_check_out || null,
                    );
                    return `Тариф: ${Number(room.price_per_night).toLocaleString("ru-KZ")} ₸/сут. · ${nights} сут. · завтрак включён · сутки до 12:00`;
                  })()}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата записи</Label>
                <Input
                  type="date"
                  value={form.record_date}
                  onChange={(e) => setForm({ ...form, record_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Тип</Label>
                <Select
                  value={form.stay_type}
                  onValueChange={(v) => setForm({ ...form, stay_type: v as StayType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="booking">Бронь</SelectItem>
                    <SelectItem value="extension">Продление</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Заезд</Label>
                <Input
                  type="date"
                  value={form.check_in}
                  onChange={(e) => {
                    const check_in = e.target.value;
                    const next = { ...form, check_in };
                    setForm(
                      applyRoomRate(
                        next,
                        next.room_id,
                        check_in,
                        next.planned_check_out,
                      ),
                    );
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Выезд (план)</Label>
                <Input
                  type="date"
                  value={form.planned_check_out}
                  onChange={(e) => {
                    const planned_check_out = e.target.value;
                    const next = { ...form, planned_check_out };
                    setForm(
                      applyRoomRate(
                        next,
                        next.room_id,
                        next.check_in,
                        planned_check_out,
                      ),
                    );
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Сумма (₸)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.payment_amount}
                  onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Статус оплаты</Label>
                <Select
                  value={form.payment_status}
                  onValueChange={(v) =>
                    setForm({ ...form, payment_status: v as PaymentStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Оплачено</SelectItem>
                    <SelectItem value="partial">Частично</SelectItem>
                    <SelectItem value="unpaid">Не оплачено</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <PaymentMethodSelect
              preset={form.payment_method_preset}
              customText={form.payment_method_custom}
              onPresetChange={(v) => setForm({ ...form, payment_method_preset: v })}
              onCustomTextChange={(v) => setForm({ ...form, payment_method_custom: v })}
            />
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Дополнительная информация"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => (editStay ? updateStay.mutate() : createStay.mutate())}
              disabled={createStay.isPending || updateStay.isPending}
            >
              {editStay ? "Сохранить изменения" : "Сохранить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
