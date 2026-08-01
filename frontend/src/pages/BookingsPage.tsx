import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BedDouble, Flame, PartyPopper, Shirt } from "lucide-react";

import { apiFetch, ApiError } from "@/api/client";
import type {
  Banquet,
  GuestService,
  GuestServiceType,
  PaymentStatus,
  Room,
  Stay,
} from "@/api/types";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isGuestInRoom, todayLocal } from "@/lib/dates";
import { formatDate, formatMoney, paymentStatusLabel, stayTypeLabel } from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  type PaymentMethodPreset,
} from "@/lib/payment-method";
import { groupStays } from "@/lib/stay-groups";
import {
  type SpaBooking,
  type SpaPayment,
} from "@/lib/supabase";
import { toast, toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

type SourceFilter = "all" | "hotel" | "spa" | "banquet" | "service";
type TabFilter = "pending" | "unpaid" | "paid" | "all";
type PayKind = "paid" | "partial" | "unpaid";
type SourceKind = "hotel" | "spa" | "banquet" | "service";

const LAUNDRY_PRICES: Record<GuestServiceType, number> = {
  laundry_hotel: 1000,
  laundry_own: 500,
};

const LAUNDRY_LABELS: Record<GuestServiceType, string> = {
  laundry_hotel: "Стирка · порошок гостиницы · 1000 ₸/вещь",
  laundry_own: "Стирка · свой порошок · 500 ₸/вещь",
};

interface UnifiedBooking {
  key: string;
  source: SourceKind;
  guestName: string;
  detail: string;
  date: string;
  amount: number;
  payment: PayKind;
  paymentMethod: string | null;
  pendingCheckIn: boolean;
  route: string;
}

const SOURCE_META: Record<
  SourceKind,
  { label: string; icon: typeof BedDouble; badge: "default" | "warning" | "success" }
> = {
  hotel: { label: "Отель", icon: BedDouble, badge: "default" },
  spa: { label: "Сауна / баня", icon: Flame, badge: "warning" },
  banquet: { label: "Банкет", icon: PartyPopper, badge: "success" },
  service: { label: "Услуги", icon: Shirt, badge: "default" },
};

interface ServiceForm {
  service_date: string;
  service_type: GuestServiceType;
  item_count: string;
  stay_id: string;
  payment_status: PaymentStatus;
  payment_method_preset: PaymentMethodPreset | string;
  payment_method_custom: string;
  payment_date: string;
  notes: string;
}

function emptyServiceForm(): ServiceForm {
  return {
    service_date: todayLocal(),
    service_type: "laundry_hotel",
    item_count: "1",
    stay_id: "",
    payment_status: "paid",
    payment_method_preset: "cash",
    payment_method_custom: "",
    payment_date: todayLocal(),
    notes: "",
  };
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

async function fetchSpaBookings(): Promise<SpaBooking[]> {
  const from = new Date();
  from.setDate(from.getDate() - 60);
  const to = new Date();
  to.setDate(to.getDate() + 90);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const qs = new URLSearchParams({ date_from: fromStr, date_to: toStr });
  const raw = await apiFetch<SpaBooking[]>(`/spa-bookings?${qs}`);
  const bookings = raw.filter((b) => b.status !== "cancelled");
  if (bookings.length === 0) return bookings;
  try {
    const ids = bookings.map((b) => b.id).join(",");
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

function spaServiceLabel(service: string): string {
  if (service === "banya") return "Русская баня";
  return "Финская сауна";
}

function isHotelPendingCheckIn(stay: Stay, rooms: Room[]): boolean {
  if (stay.check_out) return false;
  if (stay.stay_type !== "booking" && stay.stay_type !== "alumni") return false;
  if (stay.in_room) return false;
  const room = rooms.find((r) => r.stay_id === stay.id);
  if (room?.status === "booked") return true;
  const checkIn = stay.check_in || stay.record_date;
  return checkIn >= todayLocal();
}

function buildUnified(
  stays: Stay[],
  rooms: Room[],
  spa: SpaBooking[],
  banquets: Banquet[],
  services: GuestService[],
): UnifiedBooking[] {
  const hotelRows: UnifiedBooking[] = groupStays(stays)
    .filter((group) => {
      if (group.stays.some((s) => isHotelPendingCheckIn(s, rooms))) return true;
      if (group.stays.some((s) => !s.check_out)) return true;
      return group.paymentStatus !== "paid";
    })
    .map((group) => {
      const stay = group.primary;
      const payment: PayKind =
        group.paymentStatus === "paid"
          ? "paid"
          : group.paymentStatus === "partial"
            ? "partial"
            : "unpaid";
      const typeLabel = stayTypeLabel[stay.stay_type] ?? stay.stay_type;
      const roomsPart =
        group.stays.length > 1
          ? `№${group.roomNumbers} (${group.stays.length} номера)`
          : `№${stay.room_number}`;
      const peoplePart =
        stay.stay_type === "alumni" && stay.people_count > 1
          ? ` · ${stay.people_count} чел.`
          : "";
      return {
        key: `hotel-${group.key}`,
        source: "hotel" as const,
        guestName: stay.client_name,
        detail: `${roomsPart} · ${typeLabel}${peoplePart}`,
        date: stay.check_in || stay.record_date,
        amount: group.totalAmount,
        payment,
        paymentMethod: stay.payment_method,
        pendingCheckIn: group.stays.some((s) => isHotelPendingCheckIn(s, rooms)),
        route: "/registry",
      };
    });

  const spaRows: UnifiedBooking[] = spa.map((booking) => {
    const amount = booking.price ?? 0;
    const paid = Boolean(booking.payment_date) && amount > 0;
    return {
      key: `spa-${booking.id}`,
      source: "spa" as const,
      guestName: booking.guest_name,
      detail: `${spaServiceLabel(booking.service)} · ${booking.slot_time}${
        booking.room ? ` · №${booking.room}` : ""
      }`,
      date: booking.booking_date,
      amount,
      payment: paid ? ("paid" as const) : ("unpaid" as const),
      paymentMethod: booking.payment_method,
      pendingCheckIn: false,
      route: "/spa",
    };
  });

  const banquetRows: UnifiedBooking[] = banquets.map((b) => {
    const amount =
      parseFloat(b.payment_amount || "0") || parseFloat(b.prepayment || "0") || 0;
    const payment: PayKind =
      b.payment_status === "paid"
        ? "paid"
        : b.payment_status === "partial"
          ? "partial"
          : Boolean(b.payment_date) && amount > 0
            ? "paid"
            : "unpaid";
    return {
      key: `banquet-${b.id}`,
      source: "banquet" as const,
      guestName: b.guest_name,
      detail: [b.venue, b.event_time, b.people_count ? `${b.people_count} гостей` : null]
        .filter(Boolean)
        .join(" · "),
      date: b.event_date,
      amount,
      payment,
      paymentMethod: b.payment_method,
      pendingCheckIn: b.event_date >= todayLocal(),
      route: "/banquets",
    };
  });

  const serviceRows: UnifiedBooking[] = services.map((s) => {
    const payment: PayKind =
      s.payment_status === "paid"
        ? "paid"
        : s.payment_status === "partial"
          ? "partial"
          : "unpaid";
    const typeLabel =
      s.service_type === "laundry_own"
        ? "Стирка · свой порошок"
        : "Стирка · порошок гостиницы";
    return {
      key: `service-${s.id}`,
      source: "service" as const,
      guestName: s.guest_name,
      detail: `${typeLabel} · ${s.item_count} шт.${s.room_number ? ` · №${s.room_number}` : ""}`,
      date: s.service_date,
      amount: parseFloat(s.amount || "0") || 0,
      payment,
      paymentMethod: s.payment_method,
      pendingCheckIn: false,
      route: "/bookings",
    };
  });

  return [...hotelRows, ...spaRows, ...banquetRows, ...serviceRows].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function BookingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabFilter>("pending");
  const [source, setSource] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [serviceOpen, setServiceOpen] = useState(false);
  const [form, setForm] = useState<ServiceForm>(emptyServiceForm);

  const { data: stays = [], isLoading: loadingStays } = useQuery({
    queryKey: ["stays"],
    queryFn: () => apiFetch<Stay[]>("/stays"),
  });

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiFetch<Room[]>("/rooms"),
  });

  const { data: banquets = [], isLoading: loadingBanquets } = useQuery({
    queryKey: ["banquets"],
    queryFn: () => apiFetch<Banquet[]>("/banquets"),
  });

  const { data: spa = [], isLoading: loadingSpa } = useQuery({
    queryKey: ["bookings-spa"],
    queryFn: fetchSpaBookings,
  });

  const { data: guestServices = [], isLoading: loadingServices } = useQuery({
    queryKey: ["guest-services"],
    queryFn: () => apiFetch<GuestService[]>("/guest-services"),
  });

  const { data: hotelGuests = [], isLoading: hotelGuestsLoading } = useQuery({
    queryKey: ["stays", "active-for-services"],
    queryFn: () => apiFetch<Stay[]>("/stays?filter=active"),
    enabled: serviceOpen,
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

  const selectedStay = hotelGuestOptions.find((s) => String(s.id) === form.stay_id) ?? null;
  const itemCount = Math.max(1, parseInt(form.item_count, 10) || 1);
  const unitPrice = LAUNDRY_PRICES[form.service_type];
  const serviceTotal = itemCount * unitPrice;

  const rows = useMemo(
    () => buildUnified(stays, rooms, spa, banquets, guestServices),
    [stays, rooms, spa, banquets, guestServices],
  );

  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.pendingCheckIn && r.source === "hotel").length;
    const unpaid = rows.filter((r) => r.payment === "unpaid" || r.payment === "partial").length;
    const paid = rows.filter((r) => r.payment === "paid").length;
    return { pending, unpaid, paid, all: rows.length };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (source !== "all" && row.source !== source) return false;
      if (tab === "pending" && !(row.pendingCheckIn && row.source === "hotel")) return false;
      if (tab === "unpaid" && row.payment === "paid") return false;
      if (tab === "paid" && row.payment !== "paid") return false;
      if (!q) return true;
      return (
        row.guestName.toLowerCase().includes(q) ||
        row.detail.toLowerCase().includes(q) ||
        row.date.includes(q)
      );
    });
  }, [rows, source, tab, search]);

  const loading = loadingStays || loadingBanquets || loadingSpa || loadingServices;

  const tabs: { key: TabFilter; label: string; count: number }[] = [
    { key: "pending", label: "Ожидают заселения", count: counts.pending },
    { key: "unpaid", label: "Не оплачено", count: counts.unpaid },
    { key: "paid", label: "Оплачено", count: counts.paid },
    { key: "all", label: "Все", count: counts.all },
  ];

  const sources: { key: SourceFilter; label: string }[] = [
    { key: "all", label: "Все источники" },
    { key: "hotel", label: "Отель" },
    { key: "spa", label: "Сауна / баня" },
    { key: "banquet", label: "Банкеты" },
    { key: "service", label: "Услуги" },
  ];

  const openServiceDialog = () => {
    setForm(emptyServiceForm());
    setServiceOpen(true);
  };

  const saveService = useMutation({
    mutationFn: async () => {
      if (!selectedStay) {
        toastError("Выберите номер или гостя");
        throw new Error("validation");
      }
      if (!(itemCount > 0)) {
        toastError("Укажите количество вещей");
        throw new Error("validation");
      }
      const paid = form.payment_status !== "unpaid";
      if (paid) {
        if (!form.payment_date) {
          toastError("Укажите дату оплаты");
          throw new Error("validation");
        }
        if (!resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)) {
          toastError("Укажите способ оплаты");
          throw new Error("validation");
        }
      }
      return apiFetch<GuestService>("/guest-services", {
        method: "POST",
        body: JSON.stringify({
          service_date: form.service_date,
          service_type: form.service_type,
          item_count: itemCount,
          stay_id: selectedStay.id,
          client_id: selectedStay.client_id,
          room_id: selectedStay.room_id,
          guest_name: selectedStay.client_name,
          room_number: selectedStay.room_number,
          payment_status: form.payment_status,
          payment_method: paid
            ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
            : null,
          payment_date: paid ? form.payment_date || todayLocal() : null,
          notes: form.notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Услуга добавлена");
      setServiceOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["guest-services"] });
      void queryClient.invalidateQueries({ queryKey: ["analytics"] });
      void queryClient.invalidateQueries({ queryKey: ["crm-trash"] });
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      if (e instanceof ApiError) toastError(e.message);
      else toastError("Не удалось сохранить услугу");
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Бронь в отеле</h1>
          <p className="text-sm text-muted-foreground">
            Брони без заселения и оплаты из журнала отеля, сауны/бани и банкетов
          </p>
        </div>
        <Button type="button" variant="outline" onClick={openServiceDialog}>
          <Shirt className="h-4 w-4" />
          Услуги для гостей
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition",
              tab === item.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted",
            )}
          >
            {item.label}
            <span className="ml-2 opacity-80">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Поиск по ФИО, номеру, дате…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {sources.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSource(item.key)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs transition",
                source === item.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Источник</th>
              <th className="px-4 py-3 text-left font-medium">Гость</th>
              <th className="px-4 py-3 text-left font-medium">Дата</th>
              <th className="px-4 py-3 text-left font-medium">Детали</th>
              <th className="px-4 py-3 text-left font-medium">Сумма</th>
              <th className="px-4 py-3 text-left font-medium">Оплата</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Загрузка...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Записей нет
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const meta = SOURCE_META[row.source];
                const Icon = meta.icon;
                return (
                  <tr key={row.key} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Badge variant={meta.badge} className="gap-1">
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      {row.pendingCheckIn && row.source === "hotel" && (
                        <div className="mt-1">
                          <Badge variant="warning" className="text-[10px]">
                            Ждёт заселения
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">{row.guestName}</td>
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.detail || "—"}</td>
                    <td className="px-4 py-3">
                      {row.amount > 0 ? formatMoney(row.amount) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div>{paymentStatusLabel[row.payment]}</div>
                      {row.paymentMethod && (
                        <div className="text-xs text-muted-foreground">
                          {formatPaymentMethod(row.paymentMethod)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.source === "service" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => navigate(row.route)}>
                          Открыть
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Услуги для гостей</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Услуга</Label>
              <Select
                value={form.service_type}
                onValueChange={(v) =>
                  setForm((p) => ({ ...p, service_type: v as GuestServiceType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="laundry_hotel">{LAUNDRY_LABELS.laundry_hotel}</SelectItem>
                  <SelectItem value="laundry_own">{LAUNDRY_LABELS.laundry_own}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Гость / номер</Label>
              <Select
                value={form.stay_id}
                onValueChange={(v) => setForm((p) => ({ ...p, stay_id: v }))}
                disabled={hotelGuestsLoading || hotelGuestOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      hotelGuestsLoading
                        ? "Загрузка гостей…"
                        : hotelGuestOptions.length === 0
                          ? "Нет гостей в журнале / бронях"
                          : "Выберите гостя или номер"
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
              {!hotelGuestsLoading && hotelGuestOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Добавьте гостя или бронь в журнале заселений — тогда имя появится здесь.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Дата</Label>
                <Input
                  type="date"
                  value={form.service_date}
                  onChange={(e) => setForm((p) => ({ ...p, service_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Кол-во вещей</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.item_count}
                  onChange={(e) => setForm((p) => ({ ...p, item_count: e.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  Сумма ({unitPrice.toLocaleString("ru-KZ")} ₸ × {itemCount} шт.)
                </span>
                <span className="font-semibold tabular-nums text-emerald-700">
                  {formatMoney(serviceTotal)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Статус оплаты</Label>
              <Select
                value={form.payment_status}
                onValueChange={(v) => {
                  const payment_status = v as PaymentStatus;
                  setForm((p) => ({
                    ...p,
                    payment_status,
                    payment_date:
                      payment_status === "unpaid" ? "" : p.payment_date || todayLocal(),
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Оплачено</SelectItem>
                  <SelectItem value="unpaid">Не оплачено</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.payment_status !== "unpaid" && (
              <>
                <div className="space-y-2">
                  <Label>Дата оплаты</Label>
                  <Input
                    type="date"
                    value={form.payment_date}
                    onChange={(e) => setForm((p) => ({ ...p, payment_date: e.target.value }))}
                  />
                </div>
                <PaymentMethodSelect
                  preset={form.payment_method_preset}
                  customText={form.payment_method_custom}
                  onPresetChange={(value) =>
                    setForm((p) => ({ ...p, payment_method_preset: value }))
                  }
                  onCustomTextChange={(value) =>
                    setForm((p) => ({ ...p, payment_method_custom: value }))
                  }
                />
              </>
            )}

            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Дополнительная информация"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => saveService.mutate()} disabled={saveService.isPending}>
              {saveService.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
