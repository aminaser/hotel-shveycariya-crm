import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type { Stay } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { logClientActivity } from "@/lib/activity";
import { todayLocal as todayLocalShared, isGuestInRoom } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
  type PaymentMethodPreset,
} from "@/lib/payment-method";
import { canManagePrices, useAuthStore, type AuthUser } from "@/stores/auth";
import {
  type SpaBooking,
  type SpaBookingCreate,
  type SpaBookingStatus,
  type SpaPayment,
  type SpaService,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";

interface SpaPrices {
  sauna: number;
  banya: number;
}

const DEFAULT_SPA_PRICES: SpaPrices = { sauna: 5000, banya: 5000 };

const SLOTS = ["14:00", "15:30", "16:00", "17:30", "18:00", "19:00", "20:00"];

const STATUS_LABEL: Record<SpaBookingStatus, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждена",
  cancelled: "Отменена",
  done: "Завершена",
};

const STATUS_VARIANT: Record<
  SpaBookingStatus,
  "default" | "success" | "warning" | "danger" | "muted"
> = {
  pending: "warning",
  confirmed: "success",
  cancelled: "muted",
  done: "default",
};

const SERVICE_LABEL: Record<SpaService, string> = {
  sauna: "Финская сауна",
  banya: "Русская баня",
};

const SOURCE_LABEL: Record<string, string> = {
  concierge: "AI-консьерж",
  crm: "CRM",
  walk_in: "Вне отеля",
};

interface SpaForm {
  booking_date: string;
  slot_time: string;
  service: SpaService;
  guest_name: string;
  guest_phone: string;
  room: string;
  is_hotel_guest: boolean;
  people_count: number;
  status: SpaBookingStatus;
  source: string;
  notes: string;
  amount: string;
  payment_method_preset: PaymentMethodPreset | string;
  payment_method_custom: string;
  payment_date: string;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return toIsoDate(new Date());
}

function daysOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function weekAhead(): string {
  return daysOffset(7);
}

function monthBehind(): string {
  return daysOffset(-30);
}

function emptyForm(prices: SpaPrices = DEFAULT_SPA_PRICES): SpaForm {
  return {
    booking_date: todayLocal(),
    slot_time: "16:00",
    service: "sauna",
    guest_name: "",
    guest_phone: "",
    room: "",
    is_hotel_guest: false,
    people_count: 1,
    status: "confirmed",
    source: "walk_in",
    notes: "",
    amount: String(prices.sauna),
    payment_method_preset: "cash",
    payment_method_custom: "",
    payment_date: todayLocalShared(),
  };
}

async function fetchBookings(dateFrom: string, dateTo: string): Promise<SpaBooking[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("spa_bookings")
    .select("*")
    .is("deleted_at", null)
    .gte("booking_date", dateFrom)
    .lte("booking_date", dateTo)
    .order("booking_date", { ascending: false })
    .order("slot_time", { ascending: false });
  if (error) throw new Error(error.message);
  const bookings = (data ?? []) as SpaBooking[];
  if (bookings.length === 0) return bookings;

  const ids = bookings.map((b) => b.id).join(",");
  try {
    const payments = await apiFetch<SpaPayment[]>(`/spa-payments?booking_ids=${ids}`);
    const byId = new Map(payments.map((p) => [p.booking_id, p]));
    return bookings.map((booking) => {
      const payment = byId.get(booking.id);
      if (!payment) {
        return { ...booking, payment_method: null, payment_date: null };
      }
      return {
        ...booking,
        price: Number(payment.amount) || booking.price,
        payment_method: payment.payment_method,
        payment_date: payment.payment_date,
      };
    });
  } catch {
    return bookings.map((booking) => ({
      ...booking,
      payment_method: null,
      payment_date: null,
    }));
  }
}

async function upsertSpaPayment(payload: {
  booking_id: string;
  amount: number;
  payment_method: string | null;
  payment_date: string | null;
}) {
  await apiFetch("/spa-payments", {
    method: "PUT",
    body: JSON.stringify({
      booking_id: payload.booking_id,
      amount: String(payload.amount),
      payment_method: payload.payment_method,
      payment_date: payload.payment_date,
    }),
  });
}

async function createBooking(
  payload: SpaBookingCreate,
  authorName: string,
  payment: {
    amount: number;
    payment_method: string | null;
    payment_date: string | null;
  },
) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { data, error } = await supabase
    .from("spa_bookings")
    .insert({
      ...payload,
      guest_phone: payload.guest_phone || null,
      room: payload.room || null,
      notes: payload.notes || null,
      created_by_name: authorName,
      updated_by_name: authorName,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Не удалось получить id записи");
  await upsertSpaPayment({
    booking_id: data.id,
    amount: payment.amount,
    payment_method: payment.payment_method,
    payment_date: payment.payment_date,
  });
}

async function updateBooking(
  id: string,
  payload: SpaBookingCreate,
  authorName: string,
  payment: {
    amount: number;
    payment_method: string | null;
    payment_date: string | null;
  },
) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { error } = await supabase
    .from("spa_bookings")
    .update({
      ...payload,
      guest_phone: payload.guest_phone || null,
      room: payload.room || null,
      notes: payload.notes || null,
      updated_by_name: authorName,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await upsertSpaPayment({
    booking_id: id,
    amount: payment.amount,
    payment_method: payment.payment_method,
    payment_date: payment.payment_date,
  });
}

async function softDeleteBooking(id: string, authorName: string) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { error } = await supabase
    .from("spa_bookings")
    .update({ deleted_at: new Date().toISOString(), updated_by_name: authorName })
    .eq("id", id);
  if (error) throw new Error(error.message);
  try {
    await apiFetch(`/spa-payments/${id}`, { method: "DELETE" });
  } catch {
    // Payment row may not exist for older bookings.
  }
}


async function updateBookingStatus(id: string, status: SpaBookingStatus, authorName: string) {
  if (!supabase) throw new Error("Supabase не настроен");
  const { error } = await supabase
    .from("spa_bookings")
    .update({ status, updated_by_name: authorName })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Keep linked guest request in sync when possible.
  const { data } = await supabase
    .from("spa_bookings")
    .select("request_id")
    .eq("id", id)
    .maybeSingle();
  if (data?.request_id) {
    const stage =
      status === "confirmed"
        ? "assigned"
        : status === "done"
          ? "done"
          : status === "cancelled"
            ? "done"
            : "received";
    await supabase
      .from("requests")
      .update({ stage, updated_by_name: authorName })
      .eq("id", data.request_id);
  }
}

function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

function stayGuestLabel(stay: Stay): string {
  const inRoom = isGuestInRoom(
    stay.check_out,
    stay.check_in ?? stay.record_date,
    stay.stay_type,
    stay.planned_check_out,
    { checkedInAt: stay.checked_in_at, inRoom: stay.in_room },
  );
  const status = inRoom ? "в номере" : "заселение в 13:00";
  return `${stay.client_name} · №${stay.room_number} · ${status}`;
}

export function SpaJournalPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEditPrices = canManagePrices(user);
  const authorName = useAuthStore((s) => s.user?.full_name ?? s.username ?? "Пользователь");
  const [dateFrom, setDateFrom] = useState(monthBehind);
  const [dateTo, setDateTo] = useState(weekAhead);
  const [serviceFilter, setServiceFilter] = useState<"all" | SpaService>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SpaBookingStatus>("all");
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ sauna: "5000", banya: "5000" });
  const [form, setForm] = useState(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedStayId, setSelectedStayId] = useState<string>("");

  const { data: spaPrices = DEFAULT_SPA_PRICES } = useQuery({
    queryKey: ["spa-prices"],
    queryFn: () => apiFetch<SpaPrices>("/spa-prices"),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!pricesOpen) return;
    setPriceDraft({
      sauna: String(Math.round(spaPrices.sauna)),
      banya: String(Math.round(spaPrices.banya)),
    });
  }, [pricesOpen, spaPrices]);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<AuthUser[]>("/users"),
  });
  const authorNameFilter = users.find((u) => u.id === authorId)?.full_name ?? null;

  const { data: hotelGuests = [], isLoading: hotelGuestsLoading } = useQuery({
    queryKey: ["stays", "active-for-spa"],
    queryFn: () => apiFetch<Stay[]>("/stays?filter=active"),
    enabled: dialogOpen && form.is_hotel_guest,
  });

  const hotelGuestOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Stay[] = [];
    for (const stay of hotelGuests) {
      const key = `${stay.client_id}-${stay.room_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(stay);
    }
    return options.sort((a, b) => a.client_name.localeCompare(b.client_name, "ru"));
  }, [hotelGuests]);

  const applyHotelGuest = (stayId: string) => {
    setSelectedStayId(stayId);
    const stay = hotelGuestOptions.find((s) => String(s.id) === stayId);
    if (!stay) return;
    setForm((prev) => ({
      ...prev,
      guest_name: stay.client_name,
      guest_phone: stay.client_phone ?? "",
      room: stay.room_number,
      is_hotel_guest: true,
      source: "crm",
    }));
  };

  const { data: bookings = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["spa-bookings", dateFrom, dateTo],
    queryFn: () => fetchBookings(dateFrom, dateTo),
    enabled: isSupabaseConfigured,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("crm-spa-bookings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "spa_bookings" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
          void queryClient.invalidateQueries({ queryKey: ["spa-bookings-trash"] });
        },
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient]);

  const invalidateBookings = () => {
    void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
    void queryClient.invalidateQueries({ queryKey: ["spa-bookings-trash"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    void queryClient.invalidateQueries({ queryKey: ["bookings-spa"] });
  };

  const saveMutation = useMutation({
    mutationFn: ({
      payload,
      payment,
    }: {
      payload: SpaBookingCreate;
      payment: {
        amount: number;
        payment_method: string | null;
        payment_date: string | null;
      };
    }) =>
      editingId
        ? updateBooking(editingId, payload, authorName, payment)
        : createBooking(payload, authorName, payment),
    onSuccess: (_data, vars) => {
      toast.success(editingId ? "Запись обновлена" : "Запись добавлена в журнал");
      void logClientActivity({
        action: editingId ? "Изменила запись сауны/бани" : "Создала запись сауны/бани",
        entity_type: "spa",
        entity_label: `${vars.payload.service}: ${vars.payload.guest_name}`,
        new_value: `${vars.payload.booking_date} ${vars.payload.slot_time}`,
      });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm(spaPrices));
      if (vars.payload.booking_date < dateFrom) setDateFrom(vars.payload.booking_date);
      if (vars.payload.booking_date > dateTo) setDateTo(vars.payload.booking_date);
      invalidateBookings();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveSpaPrices = useMutation({
    mutationFn: () =>
      apiFetch<SpaPrices>("/spa-prices", {
        method: "PUT",
        body: JSON.stringify({
          sauna: Math.max(0, Number(priceDraft.sauna) || 0),
          banya: Math.max(0, Number(priceDraft.banya) || 0),
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["spa-prices"], data);
      toast.success("Цены сауны/бани сохранены");
      setPricesOpen(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сохранить цены");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDeleteBooking(id, authorName),
    onSuccess: () => {
      toast.success("Запись перемещена в корзину");
      void logClientActivity({
        action: "Удалила запись сауны/бани",
        entity_type: "spa",
      });
      invalidateBookings();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SpaBookingStatus }) =>
      updateBookingStatus(id, status, authorName),
    onSuccess: () => {
      toast.success("Статус обновлён");
      void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (serviceFilter !== "all" && b.service !== serviceFilter) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (authorNameFilter && b.created_by_name !== authorNameFilter) return false;
      return true;
    });
  }, [bookings, serviceFilter, statusFilter, authorNameFilter]);

  const todayCount = bookings.filter(
    (b) => b.booking_date === todayLocal() && b.status !== "cancelled",
  ).length;
  const externalCount = bookings.filter((b) => !b.is_hotel_guest && b.status !== "cancelled").length;
  const conciergeCount = bookings.filter(
    (b) => b.source === "concierge" && b.status !== "cancelled",
  ).length;

  const submitForm = () => {
    if (!form.guest_name.trim()) {
      toast.error("Укажите имя гостя");
      return;
    }
    const amount = Math.max(0, Number(form.amount) || 0);
    if (amount > 0) {
      if (!form.payment_date) {
        toast.error("Укажите дату оплаты");
        return;
      }
      if (!resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)) {
        toast.error("Укажите способ оплаты");
        return;
      }
    }
    const paymentMethod =
      amount > 0
        ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
        : null;
    const paymentDate = amount > 0 ? form.payment_date || todayLocalShared() : null;

    saveMutation.mutate({
      payload: {
        booking_date: form.booking_date,
        slot_time: form.slot_time,
        service: form.service,
        guest_name: form.guest_name.trim(),
        guest_phone: form.guest_phone.trim() || null,
        room: form.is_hotel_guest ? form.room.trim() || null : null,
        is_hotel_guest: form.is_hotel_guest,
        people_count: Number(form.people_count) || 1,
        status: form.status ?? "confirmed",
        source: form.is_hotel_guest ? "crm" : "walk_in",
        notes: form.notes.trim() || null,
        price: amount,
      },
      payment: {
        amount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
      },
    });
  };

  const openEdit = (booking: SpaBooking) => {
    setEditingId(booking.id);
    setSelectedStayId("");
    const { preset, customText } = splitPaymentMethod(booking.payment_method);
    const amount =
      booking.price != null && booking.price > 0
        ? String(booking.price)
        : String(spaPrices[booking.service] ?? 0);
    setForm({
      booking_date: booking.booking_date,
      slot_time: booking.slot_time,
      service: booking.service,
      guest_name: booking.guest_name,
      guest_phone: booking.guest_phone ?? "",
      room: booking.room ?? "",
      is_hotel_guest: booking.is_hotel_guest,
      people_count: booking.people_count,
      status: booking.status,
      source: booking.source,
      notes: booking.notes ?? "",
      amount,
      payment_method_preset: preset,
      payment_method_custom: customText,
      payment_date: booking.payment_date ?? todayLocalShared(),
    });
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!dialogOpen || !form.is_hotel_guest || hotelGuestOptions.length === 0) return;
    if (selectedStayId) return;
    const match = hotelGuestOptions.find(
      (stay) =>
        stay.client_name === form.guest_name &&
        (!form.room || stay.room_number === form.room),
    );
    if (match) setSelectedStayId(String(match.id));
  }, [dialogOpen, form.is_hotel_guest, form.guest_name, form.room, hotelGuestOptions, selectedStayId]);

  if (!isSupabaseConfigured) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Журнал сауны / бани</h1>
        <p className="mt-2 text-muted-foreground">
          Supabase не настроен. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Журнал сауны / бани</h1>
          <p className="text-sm text-muted-foreground">
            Записи из AI-консьержа и ручные брони гостей отеля и внешних посетителей
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          {canEditPrices && (
            <Button variant="outline" size="sm" onClick={() => setPricesOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Цены сауны / бани
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setSelectedStayId("");
              setForm(emptyForm(spaPrices));
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить запись
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Сегодня</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{todayCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Из консьержа</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{conciergeCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Вне отеля</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{externalCount}</CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label className="text-xs">С</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">По</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Услуга</Label>
          <Select
            value={serviceFilter}
            onValueChange={(v) => setServiceFilter(v as "all" | SpaService)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="sauna">Сауна</SelectItem>
              <SelectItem value="banya">Баня</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Статус</Label>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "all" | SpaBookingStatus)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="pending">Ожидает</SelectItem>
              <SelectItem value="confirmed">Подтверждена</SelectItem>
              <SelectItem value="done">Завершена</SelectItem>
              <SelectItem value="cancelled">Отменена</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end pb-0.5">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {isError && (
        <p className="text-destructive">
          {error instanceof Error ? error.message : "Ошибка загрузки"}
        </p>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Записей за выбранный период нет. Добавьте вручную или дождитесь брони из AI-консьержа.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((booking) => (
          <Card key={booking.id}>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{SERVICE_LABEL[booking.service]}</span>
                  <Badge variant={STATUS_VARIANT[booking.status]}>
                    {STATUS_LABEL[booking.status]}
                  </Badge>
                  <Badge variant="muted">{SOURCE_LABEL[booking.source] ?? booking.source}</Badge>
                  {!booking.is_hotel_guest && <Badge variant="default">Вне отеля</Badge>}
                </div>
                <div className="text-sm">
                  {formatDate(booking.booking_date)} · {booking.slot_time} · {booking.guest_name}
                  {booking.room ? ` · номер ${booking.room}` : ""}
                  {booking.guest_phone ? ` · ${booking.guest_phone}` : ""}
                  {booking.people_count > 1 ? ` · ${booking.people_count} чел.` : ""}
                </div>
                {booking.notes && (
                  <div className="text-sm text-muted-foreground">{booking.notes}</div>
                )}
                <div className="text-xs text-muted-foreground">
                  {booking.payment_date && booking.price != null && booking.price > 0 ? (
                    <>
                      Сумма: {formatMoney(booking.price)}
                      {booking.payment_method
                        ? ` · ${formatPaymentMethod(booking.payment_method)}`
                        : ""}
                      {` · оплата ${formatDate(booking.payment_date)}`}
                    </>
                  ) : (
                    "Оплата не указана"
                  )}
                </div>
                <AuthorshipMeta
                  createdByName={booking.created_by_name}
                  createdAt={booking.created_at}
                  updatedByName={booking.updated_by_name}
                  updatedAt={booking.updated_at}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {booking.status === "pending" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      statusMutation.mutate({ id: booking.id, status: "confirmed" })
                    }
                  >
                    Подтвердить
                  </Button>
                )}
                {(booking.status === "pending" || booking.status === "confirmed") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: booking.id, status: "done" })}
                  >
                    Завершить
                  </Button>
                )}
                {booking.status !== "cancelled" && booking.status !== "done" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      statusMutation.mutate({ id: booking.id, status: "cancelled" })
                    }
                  >
                    Отменить
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => openEdit(booking)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Редактировать
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => deleteMutation.mutate(booking.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Удалить
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(null);
        }}
      >
        <DialogContent className="max-w-lg" closeOnOutsideClick={false}>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Редактировать запись" : "Новая запись в журнал"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Тип гостя</Label>
              <Select
                value={form.is_hotel_guest ? "hotel" : "external"}
                onValueChange={(v) => {
                  const isHotel = v === "hotel";
                  setSelectedStayId("");
                  setForm((prev) => ({
                    ...prev,
                    is_hotel_guest: isHotel,
                    source: isHotel ? "crm" : "walk_in",
                    guest_name: isHotel ? "" : prev.guest_name,
                    guest_phone: isHotel ? "" : prev.guest_phone,
                    room: isHotel ? "" : "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">Вне отеля (сторонний гость)</SelectItem>
                  <SelectItem value="hotel">Гость отеля</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Услуга</Label>
                <Select
                  value={form.service}
                  onValueChange={(v) => {
                    const service = v as SpaService;
                    setForm((prev) => ({
                      ...prev,
                      service,
                      amount: String(spaPrices[service]),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sauna">Финская сауна</SelectItem>
                    <SelectItem value="banya">Русская баня</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Время</Label>
                <Select
                  value={form.slot_time}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, slot_time: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOTS.map((slot) => (
                      <SelectItem key={slot} value={slot}>
                        {slot}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Дата</Label>
                <Input
                  type="date"
                  value={form.booking_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, booking_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Человек</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.people_count ?? 1}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, people_count: Number(e.target.value) || 1 }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>ФИО</Label>
              {form.is_hotel_guest ? (
                <Select
                  value={selectedStayId}
                  onValueChange={applyHotelGuest}
                  disabled={hotelGuestsLoading || hotelGuestOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        hotelGuestsLoading
                          ? "Загрузка гостей…"
                          : hotelGuestOptions.length === 0
                            ? "Нет гостей в журнале / бронях"
                            : "Выберите гостя из журнала"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {hotelGuestOptions.map((stay) => (
                      <SelectItem key={stay.id} value={String(stay.id)}>
                        {stayGuestLabel(stay)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.guest_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, guest_name: e.target.value }))}
                  placeholder="Имя гостя"
                />
              )}
              {form.is_hotel_guest && !hotelGuestsLoading && hotelGuestOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Добавьте гостя или бронь в журнале заселений — тогда имя появится здесь.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Телефон</Label>
                <Input
                  value={form.guest_phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, guest_phone: e.target.value }))}
                  placeholder="+7…"
                />
              </div>
              {form.is_hotel_guest ? (
                <div className="space-y-2">
                  <Label>Номер</Label>
                  <Input value={form.room} readOnly placeholder="Выберите гостя" />
                </div>
              ) : (
                <div />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Сумма, ₸</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата оплаты</Label>
                <Input
                  type="date"
                  value={form.payment_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, payment_date: e.target.value }))}
                  disabled={!form.amount || Number(form.amount) <= 0}
                />
              </div>
            </div>
            <PaymentMethodSelect
              preset={form.payment_method_preset}
              customText={form.payment_method_custom}
              onPresetChange={(value) =>
                setForm((prev) => ({ ...prev, payment_method_preset: value }))
              }
              onCustomTextChange={(value) =>
                setForm((prev) => ({ ...prev, payment_method_custom: value }))
              }
            />

            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Веники, пожелания…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submitForm} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pricesOpen} onOpenChange={setPricesOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Цены сауны / бани</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Базовые цены для новых записей. Только для Жибек.
          </p>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Финская сауна, ₸</Label>
              <Input
                type="number"
                min={0}
                value={priceDraft.sauna}
                onChange={(e) => setPriceDraft((prev) => ({ ...prev, sauna: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Русская баня, ₸</Label>
              <Input
                type="number"
                min={0}
                value={priceDraft.banya}
                onChange={(e) => setPriceDraft((prev) => ({ ...prev, banya: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPricesOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => saveSpaPrices.mutate()} disabled={saveSpaPrices.isPending}>
              {saveSpaPrices.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
