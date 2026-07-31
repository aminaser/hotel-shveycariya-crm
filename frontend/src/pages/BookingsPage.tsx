import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { BedDouble, Flame, PartyPopper } from "lucide-react";

import { apiFetch } from "@/api/client";
import type { Banquet, Room, Stay } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayLocal } from "@/lib/dates";
import { formatDate, formatMoney, paymentStatusLabel, stayTypeLabel } from "@/lib/format";
import { formatPaymentMethod } from "@/lib/payment-method";
import { groupStays } from "@/lib/stay-groups";
import {
  type SpaBooking,
  type SpaPayment,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";

type SourceFilter = "all" | "hotel" | "spa" | "banquet";
type TabFilter = "pending" | "unpaid" | "paid" | "all";
type PayKind = "paid" | "partial" | "unpaid";
type SourceKind = "hotel" | "spa" | "banquet";

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
};

async function fetchSpaBookings(): Promise<SpaBooking[]> {
  if (!supabase) return [];
  const from = new Date();
  from.setDate(from.getDate() - 60);
  const to = new Date();
  to.setDate(to.getDate() + 90);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("spa_bookings")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .gte("booking_date", fromStr)
    .lte("booking_date", toStr)
    .order("booking_date", { ascending: true });
  if (error) throw new Error(error.message);
  const bookings = (data ?? []) as SpaBooking[];
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
  const room = rooms.find((r) => r.stay_id === stay.id);
  if (room?.status === "booked") return true;
  const checkIn = stay.check_in || stay.record_date;
  return checkIn > todayLocal();
}

function buildUnified(
  stays: Stay[],
  rooms: Room[],
  spa: SpaBooking[],
  banquets: Banquet[],
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
    const prepay = parseFloat(b.prepayment) || 0;
    const paid = Boolean(b.payment_date) && prepay > 0;
    return {
      key: `banquet-${b.id}`,
      source: "banquet" as const,
      guestName: b.guest_name,
      detail: [b.venue, b.event_time, b.people_count ? `${b.people_count} гостей` : null]
        .filter(Boolean)
        .join(" · "),
      date: b.event_date,
      amount: prepay,
      payment: paid ? ("paid" as const) : ("unpaid" as const),
      paymentMethod: b.payment_method,
      pendingCheckIn: b.event_date >= todayLocal(),
      route: "/banquets",
    };
  });

  return [...hotelRows, ...spaRows, ...banquetRows].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function BookingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabFilter>("pending");
  const [source, setSource] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");

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
    enabled: isSupabaseConfigured,
  });

  const rows = useMemo(
    () => buildUnified(stays, rooms, spa, banquets),
    [stays, rooms, spa, banquets],
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

  const loading = loadingStays || loadingBanquets || loadingSpa;

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
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Бронь в отеле</h1>
        <p className="text-sm text-muted-foreground">
          Брони без заселения и оплаты из журнала отеля, сауны/бани и банкетов
        </p>
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
                      <Button size="sm" variant="outline" onClick={() => navigate(row.route)}>
                        Открыть
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!isSupabaseConfigured && (
        <p className="mt-3 text-xs text-muted-foreground">
          Сауна/баня не подключена (нет Supabase) — в списке только отель и банкеты.
        </p>
      )}
    </div>
  );
}
