import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays, PartyPopper, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type { Banquet, PaymentStatus } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { BanquetMenuSheet } from "@/components/BanquetMenuSheet";
import {
  PartialPaymentRemainder,
  paymentDateForEvent,
} from "@/components/PartialPaymentRemainder";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  BANQUET_SERVICE_CHARGE_PERCENT,
  dishesTotalWithService,
  formatDishesPreview,
  parseDishes,
} from "@/lib/banquet-dishes";
import { todayLocal } from "@/lib/dates";
import { formatDate, formatMoney, paymentStatusLabel } from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
  type PaymentMethodPreset,
} from "@/lib/payment-method";
import { cn } from "@/lib/utils";

function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function formatRuDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMMM yyyy", { locale: ru });
  } catch {
    return iso;
  }
}

/** «Ас» package: N people × chosen rate, no service charge. */
const AS_VENUE = "Ас";
/** Two fixed rates shown to every user. */
const AS_PRICE_OLD = 2700;
const AS_PRICE_NEW = 3000;
const AS_PRICE_OPTIONS = [
  { price: AS_PRICE_OLD, label: "Старая цена" },
  { price: AS_PRICE_NEW, label: "С человека" },
] as const;
const DEFAULT_AS_PRICE = AS_PRICE_NEW;
/** «Поминки»: menu + 10% обслуживание. Kind is stored in event_type. */
const POMINKI_VENUE = "Поминки";

/** Physical venues available for banquet / Ас / поминки. */
const VENUE_OPTIONS = [
  "Второй",
  "Вип зал",
  "Королевский",
  "Сауна",
  "Баня",
  "Жемчужина",
  "Зеленая кабинка",
  "Барный зал",
] as const;

type BookingKind = "normal" | "as" | "pominki";
type AsPriceOption = (typeof AS_PRICE_OPTIONS)[number]["price"];

interface BanquetForm {
  kind: BookingKind;
  event_date: string;
  event_time: string;
  guest_name: string;
  phone: string;
  venue: string;
  people_count: string;
  event_type: string;
  as_price_per_person: AsPriceOption;
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  payment_method_preset: PaymentMethodPreset | string;
  payment_method_custom: string;
  payment_date: string;
  dishes: string;
  notes: string;
}

function isLegacyKindVenue(venue: string | null | undefined): boolean {
  const v = (venue ?? "").trim().toLowerCase();
  return v === AS_VENUE.toLowerCase() || v === POMINKI_VENUE.toLowerCase();
}

function isPominkiRecord(
  venue?: string | null,
  eventType?: string | null,
): boolean {
  const v = (venue ?? "").trim().toLowerCase();
  const t = (eventType ?? "").trim().toLowerCase();
  return v === "поминки" || t === "поминки" || t.startsWith("поминки");
}

function isAsRecord(venue?: string | null, eventType?: string | null): boolean {
  if (isPominkiRecord(venue, eventType)) return false;
  const v = (venue ?? "").trim().toLowerCase();
  const t = (eventType ?? "").trim();
  if (v === "ас") return true;
  if (/₸\s*\/\s*чел/i.test(t) || /\/чел/i.test(t)) return true;
  if (t.toLowerCase().startsWith("ас")) return true;
  return false;
}

function isAsBooking(b: Banquet): boolean {
  return isAsRecord(b.venue, b.event_type);
}

function isPominkiBooking(b: Banquet): boolean {
  return isPominkiRecord(b.venue, b.event_type);
}

function bookingKindOf(b: Banquet): BookingKind {
  if (isPominkiBooking(b)) return "pominki";
  if (isAsBooking(b)) return "as";
  return "normal";
}

function displayVenue(b: Banquet): string | null {
  const venue = (b.venue ?? "").trim();
  if (!venue || isLegacyKindVenue(venue)) return null;
  return venue;
}

function bookingKindLabel(b: Banquet): string {
  const kind = bookingKindOf(b);
  if (kind === "as") return "Ас";
  if (kind === "pominki") return "Поминки";
  return "Банкет";
}

function bookingKindBadge(
  b: Banquet,
): "default" | "success" | "warning" | "muted" {
  const kind = bookingKindOf(b);
  if (kind === "as") return "success";
  if (kind === "pominki") return "muted";
  return "warning";
}

function asPackageTotal(
  peopleCount: string | number,
  pricePerPerson: number,
): number {
  const n =
    typeof peopleCount === "number"
      ? peopleCount
      : Math.max(1, parseInt(peopleCount, 10) || 1);
  return n * pricePerPerson;
}

function formatAsRate(price: number): string {
  return `${Math.round(price).toLocaleString("ru-KZ")} ₸/чел`;
}

function asRateEventType(price: number): string {
  const option = AS_PRICE_OPTIONS.find((o) => o.price === price);
  const tag = option?.label ?? "";
  return tag ? `${formatAsRate(price)} · ${tag}` : formatAsRate(price);
}

function normalizeAsPrice(raw: number): AsPriceOption {
  if (raw === AS_PRICE_OLD) return AS_PRICE_OLD;
  if (raw === AS_PRICE_NEW) return AS_PRICE_NEW;
  return Math.abs(raw - AS_PRICE_OLD) <= Math.abs(raw - AS_PRICE_NEW)
    ? AS_PRICE_OLD
    : AS_PRICE_NEW;
}

/** Infer chosen Ас rate from stored amount or event_type. */
function inferAsPrice(b: Banquet): AsPriceOption {
  const type = (b.event_type ?? "").toLowerCase();
  if (type.includes("2700") || type.includes("стар")) return AS_PRICE_OLD;
  if (type.includes("3000")) return AS_PRICE_NEW;

  const people = Math.max(1, b.people_count || 1);
  const amount = parseFloat(b.payment_amount || "0");
  if (amount > 0) {
    return normalizeAsPrice(Math.round(amount / people));
  }
  return DEFAULT_AS_PRICE;
}

function inferPaymentStatus(b: Banquet): PaymentStatus {
  if (b.payment_status === "paid" || b.payment_status === "partial" || b.payment_status === "unpaid") {
    return b.payment_status;
  }
  const prepaid = parseFloat(b.prepayment || "0");
  if (prepaid <= 0) return "unpaid";
  if (isAsBooking(b)) {
    const total = asPackageTotal(b.people_count, inferAsPrice(b));
    if (prepaid >= total) return "paid";
    return "partial";
  }
  return "paid";
}

function emptyForm(
  kind: BookingKind = "normal",
  asPrice: AsPriceOption = DEFAULT_AS_PRICE,
): BanquetForm {
  const asPackage = kind === "as";
  const pominki = kind === "pominki";
  return {
    kind,
    event_date: todayLocal(),
    event_time: "",
    guest_name: "",
    phone: "",
    venue: "",
    people_count: "10",
    event_type: asPackage
      ? asRateEventType(asPrice)
      : pominki
        ? POMINKI_VENUE
        : "",
    as_price_per_person: asPrice,
    payment_amount: asPackage ? String(asPackageTotal(10, asPrice)) : "",
    prepayment: "",
    payment_status: "unpaid",
    payment_method_preset: "cash",
    payment_method_custom: "",
    payment_date: todayLocal(),
    dishes: "",
    notes: "",
  };
}

function toForm(b: Banquet): BanquetForm {
  const { preset, customText } = splitPaymentMethod(b.payment_method);
  const kind = bookingKindOf(b);
  const asMode = kind === "as";
  const asPrice = asMode ? inferAsPrice(b) : DEFAULT_AS_PRICE;
  const status = inferPaymentStatus(b);
  const amount =
    b.payment_amount && parseFloat(b.payment_amount) > 0
      ? b.payment_amount
      : asMode
        ? String(asPackageTotal(b.people_count, asPrice))
        : b.prepayment && parseFloat(b.prepayment) > 0
          ? b.prepayment
          : "";
  const venueRaw = (b.venue ?? "").trim();
  return {
    kind,
    event_date: b.event_date,
    event_time: b.event_time ?? "",
    guest_name: b.guest_name,
    phone: b.phone ?? "",
    venue: isLegacyKindVenue(venueRaw) ? "" : venueRaw,
    people_count: String(b.people_count),
    event_type: asMode
      ? b.event_type?.trim() || asRateEventType(asPrice)
      : kind === "pominki"
        ? POMINKI_VENUE
        : b.event_type ?? "",
    as_price_per_person: asPrice,
    payment_amount: amount,
    prepayment:
      status === "partial" && b.prepayment && parseFloat(b.prepayment) > 0
        ? b.prepayment
        : "",
    payment_status: status,
    payment_method_preset: preset,
    payment_method_custom: customText,
    payment_date: b.payment_date ?? "",
    dishes: b.dishes ?? "",
    notes: b.notes ?? "",
  };
}

export function BanquetsPage() {
  const queryClient = useQueryClient();
  const today = startOfDay(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date>(today);
  const [editBanquet, setEditBanquet] = useState<Banquet | null>(null);
  const [form, setForm] = useState<BanquetForm>(emptyForm());
  const [authorId, setAuthorId] = useState<number | null>(null);

  const asMode = form.kind === "as";
  const pominkiMode = form.kind === "pominki";
  const noService = asMode;
  const asPricePerPerson = form.as_price_per_person;
  const asTotal = asPackageTotal(form.people_count, asPricePerPerson);
  const paymentTotal = asMode
    ? asTotal
    : Math.max(0, parseFloat(form.payment_amount || "0") || 0);
  const dishesPreview = formatDishesPreview(form.dishes || null, {
    serviceCharge: !noService,
  });
  const parsedDishes = parseDishes(form.dishes);
  const { subtotal: dishesSum, service: serviceSum, total: grandTotal } =
    dishesTotalWithService(parsedDishes.items);
  const menuGrandTotal = noService ? dishesSum : grandTotal;

  const { data: banquets = [], isLoading } = useQuery({
    queryKey: ["banquets", authorId],
    queryFn: () => {
      const qs = authorId != null ? `?author_id=${authorId}` : "";
      return apiFetch<Banquet[]>(`/banquets${qs}`);
    },
  });

  const selectedIso = toIsoDate(selectedDay);
  const datesWithEvents = useMemo(() => {
    const set = new Set(banquets.map((b) => b.event_date));
    return [...set].map((iso) => parseISO(iso));
  }, [banquets]);

  const dayBanquets = useMemo(() => {
    return banquets
      .filter((b) => b.event_date === selectedIso)
      .sort((a, b) => {
        const ta = a.event_time ?? "";
        const tb = b.event_time ?? "";
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.guest_name.localeCompare(b.guest_name, "ru");
      });
  }, [banquets, selectedIso]);

  const nearbyDays = useMemo(() => {
    const sortDay = (list: Banquet[]) =>
      [...list].sort((a, b) => {
        const ta = a.event_time ?? "";
        const tb = b.event_time ?? "";
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.guest_name.localeCompare(b.guest_name, "ru");
      });
    const todayIso = todayLocal();
    const yesterdayIso = toIsoDate(addDays(parseISO(todayIso), -1));
    const tomorrowIso = toIsoDate(addDays(parseISO(todayIso), 1));
    return [
      {
        key: "yesterday",
        label: "Вчера",
        iso: yesterdayIso,
        items: sortDay(banquets.filter((b) => b.event_date === yesterdayIso)),
      },
      {
        key: "today",
        label: "Сегодня",
        iso: todayIso,
        items: sortDay(banquets.filter((b) => b.event_date === todayIso)),
      },
      {
        key: "tomorrow",
        label: "Завтра",
        iso: tomorrowIso,
        items: sortDay(banquets.filter((b) => b.event_date === tomorrowIso)),
      },
    ] as const;
  }, [banquets]);

  const set = (field: keyof BanquetForm) => (value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const setAsPrice = (price: AsPriceOption) => {
    setForm((p) => ({
      ...p,
      as_price_per_person: price,
      event_type: asRateEventType(price),
      payment_amount: String(asPackageTotal(p.people_count, price)),
    }));
  };

  const openDay = (d: Date) => {
    setSelectedDay(d);
    setDayDialogOpen(true);
  };

  const openCreate = (eventDate = selectedIso) => {
    setEditBanquet(null);
    setForm({ ...emptyForm("normal"), event_date: eventDate });
    setMenuOpen(false);
    setDayDialogOpen(false);
    setDialogOpen(true);
  };

  const openAsCreate = (eventDate = selectedIso) => {
    setEditBanquet(null);
    setForm({ ...emptyForm("as", DEFAULT_AS_PRICE), event_date: eventDate });
    setMenuOpen(false);
    setDayDialogOpen(false);
    setDialogOpen(true);
  };

  const openPominkiCreate = (eventDate = selectedIso) => {
    setEditBanquet(null);
    setForm({ ...emptyForm("pominki"), event_date: eventDate });
    setMenuOpen(false);
    setDayDialogOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (b: Banquet) => {
    setEditBanquet(b);
    setForm(toForm(b));
    setMenuOpen(false);
    setDayDialogOpen(false);
    setDialogOpen(true);
  };

  const buildPayload = () => {
    const people = Math.max(1, parseInt(form.people_count, 10) || 1);
    const total = asMode
      ? people * asPricePerPerson
      : Math.max(0, parseFloat(form.payment_amount || "0") || 0);
    let prepayment = "0";
    if (form.payment_status === "partial") {
      prepayment = form.prepayment.trim() || "0";
    }
    const received = form.payment_status !== "unpaid";
    return {
      event_date: form.event_date,
      event_time: form.event_time.trim() || null,
      guest_name: form.guest_name.trim(),
      phone: form.phone.trim() || null,
      venue: form.venue.trim() || null,
      people_count: people,
      event_type: asMode
        ? asRateEventType(asPricePerPerson)
        : pominkiMode
          ? POMINKI_VENUE
          : form.event_type.trim() || null,
      payment_amount: String(total),
      prepayment,
      payment_status: form.payment_status,
      payment_method: received
        ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
        : null,
      payment_date: received
        ? form.payment_date ||
          (form.payment_status === "partial"
            ? paymentDateForEvent(form.event_date, todayLocal())
            : todayLocal())
        : null,
      dishes: form.dishes.trim() || null,
      notes: form.notes.trim() || null,
    };
  };

  const validate = (): boolean => {
    if (!form.guest_name.trim()) {
      toast.error("Укажите ФИО");
      return false;
    }
    if (!form.event_date) {
      toast.error("Укажите дату проведения");
      return false;
    }
    if (!form.venue.trim()) {
      toast.error("Укажите место проведения");
      return false;
    }
    if (!asMode && form.payment_status !== "unpaid" && !(paymentTotal > 0)) {
      toast.error("Укажите сумму оплаты");
      return false;
    }
    if (form.payment_status === "partial") {
      const prepaid = parseFloat(form.prepayment || "0");
      if (!(prepaid > 0)) {
        toast.error("Укажите сумму предоплаты");
        return false;
      }
      if (paymentTotal > 0 && prepaid >= paymentTotal) {
        toast.error("Для полной оплаты выберите статус «Оплачено»");
        return false;
      }
    }
    if (form.payment_status !== "unpaid") {
      if (!form.payment_date) {
        toast.error("Укажите дату оплаты");
        return false;
      }
      if (
        !resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
      ) {
        toast.error("Укажите способ оплаты");
        return false;
      }
    }
    return true;
  };

  const onError = (e: unknown, fallback: string) => {
    if (e instanceof Error && e.message === "validation") return;
    if (e instanceof ApiError) toast.error(e.message);
    else toast.error(fallback);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!validate()) throw new Error("validation");
      return editBanquet
        ? apiFetch(`/banquets/${editBanquet.id}`, {
            method: "PATCH",
            body: JSON.stringify(buildPayload()),
          })
        : apiFetch("/banquets", {
            method: "POST",
            body: JSON.stringify(buildPayload()),
          });
    },
    onSuccess: () => {
      toast.success(editBanquet ? "Бронирование обновлено" : "Бронирование добавлено");
      setDialogOpen(false);
      setEditBanquet(null);
      queryClient.invalidateQueries({ queryKey: ["banquets"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => onError(e, "Не удалось сохранить"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/banquets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Бронирование перемещено в корзину");
      queryClient.invalidateQueries({ queryKey: ["banquets"] });
      queryClient.invalidateQueries({ queryKey: ["crm-trash"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => onError(e, "Не удалось удалить"),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="h-6 w-6" />
            Банкеты
          </h1>
          <p className="text-sm text-muted-foreground">
            Календарь банкетов, «Ас» и поминок — нажмите на дату, чтобы открыть записи
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
          <Button
            type="button"
            variant="outline"
            className="border-emerald-600/50 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
            onClick={() => openAsCreate(todayLocal())}
          >
            <PartyPopper className="h-4 w-4" />
            Ас · 2 700 / 3 000 ₸/чел
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-slate-500/40 bg-slate-50 text-slate-900 hover:bg-slate-100"
            onClick={() => openPominkiCreate(todayLocal())}
          >
            <UtensilsCrossed className="h-4 w-4" />
            Поминки
          </Button>
          <Button onClick={() => openCreate(todayLocal())}>
            <Plus className="h-4 w-4" />
            Добавить бронирование
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Загрузка...</p>
      ) : (
        <div className="flex w-full max-w-xl flex-col gap-4">
          <Card className="w-fit max-w-full">
            <CardContent className="p-4">
              <Calendar
                mode="single"
                selected={selectedDay}
                onSelect={(d) => d && openDay(d)}
                defaultMonth={selectedDay}
                modifiers={{ hasEvent: datesWithEvents }}
                modifiersClassNames={{
                  hasEvent: "rdp-day-has-event font-semibold text-primary",
                }}
                className="rdp-banquets-calendar"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  Есть запись
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  onClick={() => openDay(today)}
                >
                  Сегодня
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 pt-4">
              {nearbyDays.map((day) => (
                <div key={day.key} className="space-y-2">
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-2 text-left"
                    onClick={() => openDay(parseISO(day.iso))}
                  >
                    <span className="text-sm font-semibold">{day.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(day.iso), "d MMMM", { locale: ru })}
                      {day.items.length > 0
                        ? ` · ${day.items.length}`
                        : ""}
                    </span>
                  </button>
                  {day.items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                      Нет мероприятий
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {day.items.map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                            onClick={() => openEdit(b)}
                          >
                            <Badge variant={bookingKindBadge(b)}>
                              {bookingKindLabel(b)}
                            </Badge>
                            {b.event_time ? (
                              <span className="font-medium tabular-nums">
                                {b.event_time.slice(0, 5)}
                              </span>
                            ) : null}
                            <span className="font-medium">{b.guest_name}</span>
                            {displayVenue(b) ? (
                              <span className="text-muted-foreground">
                                · {displayVenue(b)}
                              </span>
                            ) : null}
                            {b.people_count ? (
                              <span className="text-muted-foreground">
                                · {b.people_count} чел.
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={dayDialogOpen} onOpenChange={setDayDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isSameDay(selectedDay, today) ? "Сегодня" : formatRuDate(selectedIso)}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {dayBanquets.length === 0
              ? "На этот день записей нет"
              : `${dayBanquets.length} запис${
                  dayBanquets.length === 1
                    ? "ь"
                    : dayBanquets.length < 5
                      ? "и"
                      : "ей"
                }`}
          </p>
          <div className="space-y-3 py-1">
            {dayBanquets.map((b) => {
              const kind = bookingKindOf(b);
              const status = inferPaymentStatus(b);
              const total =
                parseFloat(b.payment_amount || "0") ||
                (isAsBooking(b)
                  ? asPackageTotal(b.people_count, inferAsPrice(b))
                  : parseFloat(b.prepayment || "0") || 0);
              return (
                <div
                  key={b.id}
                  className={cn(
                    "rounded-lg border border-border p-3 transition-colors hover:bg-muted/30",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={bookingKindBadge(b)}>
                          {bookingKindLabel(b)}
                        </Badge>
                        {b.event_time ? (
                          <span className="text-sm font-medium">
                            {b.event_time.slice(0, 5)}
                          </span>
                        ) : null}
                        <span className="font-medium">{b.guest_name}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[
                          b.phone,
                          displayVenue(b),
                          b.people_count ? `${b.people_count} чел.` : null,
                          kind === "as" || kind === "pominki"
                            ? null
                            : b.event_type,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {total > 0 ? `${formatMoney(total)} · ` : ""}
                        {paymentStatusLabel[status]}
                        {status === "partial"
                          ? ` · предоплата ${formatMoney(b.prepayment)}`
                          : ""}
                        {b.payment_method
                          ? ` · ${formatPaymentMethod(b.payment_method)}`
                          : ""}
                        {b.payment_date
                          ? ` · оплата ${formatDate(b.payment_date)}`
                          : ""}
                      </div>
                      {b.dishes ? (
                        <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                          {formatDishesPreview(b.dishes, {
                            serviceCharge: !isAsBooking(b),
                          })}
                        </pre>
                      ) : null}
                      {b.notes ? (
                        <p className="text-xs text-foreground/80">{b.notes}</p>
                      ) : null}
                      <AuthorshipMeta
                        className="mt-1"
                        createdByName={b.created_by_name}
                        createdAt={b.created_at}
                        updatedByName={b.updated_by_name}
                        updatedAt={b.updated_at}
                      />
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(b)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => {
                          if (confirm(`Удалить бронирование «${b.guest_name}»?`)) {
                            deleteMutation.mutate(b.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-emerald-600/50 text-emerald-800"
                onClick={() => openAsCreate(selectedIso)}
              >
                <PartyPopper className="h-3.5 w-3.5" />
                Ас
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openPominkiCreate(selectedIso)}
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Поминки
              </Button>
            </div>
            <Button size="sm" onClick={() => openCreate(selectedIso)}>
              <Plus className="h-3.5 w-3.5" />
              Банкет
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogOpen}
        modal={!menuOpen}
        onOpenChange={(open) => {
          if (!open && menuOpen) return;
          setDialogOpen(open);
        }}
      >
        <DialogContent
          className="max-h-[90vh] max-w-lg overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (menuOpen) {
              event.preventDefault();
              setMenuOpen(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editBanquet
                ? asMode
                  ? "Редактировать «Ас»"
                  : pominkiMode
                    ? "Редактировать «Поминки»"
                    : "Редактировать бронирование"
                : asMode
                  ? "Бронирование «Ас»"
                  : pominkiMode
                    ? "Бронирование «Поминки»"
                    : "Новое бронирование банкета"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!asMode && !pominkiMode && (
              <div className="space-y-2">
                <Label>Тип бронирования</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-emerald-600/50 text-emerald-800"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        kind: "as",
                        as_price_per_person: DEFAULT_AS_PRICE,
                        event_type: asRateEventType(DEFAULT_AS_PRICE),
                        payment_amount: String(
                          asPackageTotal(p.people_count, DEFAULT_AS_PRICE),
                        ),
                        payment_status: "unpaid",
                        prepayment: "",
                      }))
                    }
                  >
                    Ас · 2 700 / 3 000 ₸/чел без обслуживания
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-slate-500/40 text-slate-800"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        kind: "pominki",
                        event_type: POMINKI_VENUE,
                        payment_status: "unpaid",
                        prepayment: "",
                      }))
                    }
                  >
                    Поминки · +{BANQUET_SERVICE_CHARGE_PERCENT}% обслуживание
                  </Button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Дата проведения</Label>
                <Input
                  type="date"
                  value={form.event_date}
                  onChange={(e) => set("event_date")(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Время проведения</Label>
                <Input
                  type="time"
                  value={form.event_time}
                  onChange={(e) => set("event_time")(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>ФИО</Label>
              <Input
                value={form.guest_name}
                onChange={(e) => set("guest_name")(e.target.value)}
                placeholder="Иванов Иван"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Телефон</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone")(e.target.value)}
                  placeholder="+7…"
                />
              </div>
              <div className="space-y-2">
                <Label>Кол-во человек</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.people_count}
                  onChange={(e) => {
                    const people_count = e.target.value;
                    setForm((p) => ({
                      ...p,
                      people_count,
                      ...(p.kind === "as"
                        ? {
                            payment_amount: String(
                              asPackageTotal(people_count, p.as_price_per_person),
                            ),
                          }
                        : {}),
                    }));
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Место проведения</Label>
              <Select
                value={form.venue || undefined}
                onValueChange={(value) => set("venue")(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите место" />
                </SelectTrigger>
                <SelectContent>
                  {VENUE_OPTIONS.map((place) => (
                    <SelectItem key={place} value={place}>
                      {place}
                    </SelectItem>
                  ))}
                  {form.venue &&
                    !(VENUE_OPTIONS as readonly string[]).includes(form.venue) && (
                      <SelectItem value={form.venue}>{form.venue}</SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>

            {asMode ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
                <div className="space-y-2">
                  <Label>Цена с человека</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {AS_PRICE_OPTIONS.map((option) => {
                      const selected = form.as_price_per_person === option.price;
                      return (
                        <button
                          key={option.price}
                          type="button"
                          onClick={() => setAsPrice(option.price)}
                          className={cn(
                            "rounded-lg border px-3 py-2.5 text-left transition",
                            selected
                              ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm"
                              : "border-border bg-background hover:border-emerald-500/40",
                          )}
                        >
                          <div className="text-base font-semibold tabular-nums">
                            {formatAsRate(option.price)}
                          </div>
                          <div className="text-xs text-muted-foreground">{option.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-between gap-2 border-t border-border/70 pt-2">
                  <span className="text-muted-foreground">
                    Сумма оплаты ({formatAsRate(asPricePerPerson)} ×{" "}
                    {Math.max(1, parseInt(form.people_count, 10) || 1)} чел.)
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {formatMoney(asTotal)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Без обслуживания</p>
                <p className="text-xs text-muted-foreground">
                  Входит: Плов без мяса, Витаминный, Пекин без мяса, Лепешки,
                  Баурсаки, Самса песочная
                </p>
              </div>
            ) : (
              <>
                {!pominkiMode && (
                  <div className="space-y-2">
                    <Label>Тип мероприятия</Label>
                    <Input
                      value={form.event_type}
                      onChange={(e) => set("event_type")(e.target.value)}
                      placeholder="Свадьба, юбилей, корпоратив…"
                    />
                  </div>
                )}
                {pominkiMode && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Меню на поминки · +{BANQUET_SERVICE_CHARGE_PERCENT}% обслуживание
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Сумма оплаты, ₸</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.payment_amount}
                    onChange={(e) => set("payment_amount")(e.target.value)}
                    placeholder={
                      menuGrandTotal > 0 ? String(Math.round(menuGrandTotal)) : "0"
                    }
                  />
                  {menuGrandTotal > 0 && (
                    <button
                      type="button"
                      className="text-xs text-emerald-700 hover:underline"
                      onClick={() =>
                        set("payment_amount")(String(Math.round(menuGrandTotal)))
                      }
                    >
                      Подставить из меню: {formatMoney(menuGrandTotal)}
                    </button>
                  )}
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Статус оплаты</Label>
              <Select
                value={form.payment_status}
                onValueChange={(v) => {
                  const payment_status = v as PaymentStatus;
                  setForm((p) => {
                    const eventDate = paymentDateForEvent(p.event_date, todayLocal());
                    return {
                      ...p,
                      payment_status,
                      payment_date:
                        payment_status === "unpaid"
                          ? ""
                          : payment_status === "partial"
                            ? eventDate
                            : p.payment_date || eventDate,
                      prepayment: payment_status === "partial" ? p.prepayment : "",
                    };
                  });
                }}
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
            {form.payment_status === "partial" && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <Label>Сумма предоплаты, ₸</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.prepayment}
                  onChange={(e) => {
                    const prepayment = e.target.value;
                    setForm((p) => ({
                      ...p,
                      prepayment,
                      payment_date:
                        parseFloat(prepayment || "0") > 0
                          ? paymentDateForEvent(p.event_date, todayLocal())
                          : p.payment_date,
                    }));
                  }}
                  placeholder="Предоплата"
                />
                <PartialPaymentRemainder
                  totalAmount={paymentTotal}
                  prepayment={form.prepayment}
                />
              </div>
            )}
            {form.payment_status !== "unpaid" && (
              <>
                <div className="space-y-2">
                  <Label>
                    {form.payment_status === "partial" ? "Дата доплаты" : "Дата оплаты"}
                  </Label>
                  <Input
                    type="date"
                    value={form.payment_date}
                    onChange={(e) => set("payment_date")(e.target.value)}
                  />
                  {form.payment_status === "partial" && (
                    <p className="text-xs text-muted-foreground">
                      По умолчанию — дата мероприятия
                    </p>
                  )}
                </div>
                <PaymentMethodSelect
                  preset={form.payment_method_preset}
                  customText={form.payment_method_custom}
                  onPresetChange={(value) => set("payment_method_preset")(value)}
                  onCustomTextChange={(value) => set("payment_method_custom")(value)}
                />
              </>
            )}

            <div className="space-y-2">
              <Label>Меню</Label>
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className={cn(
                  "group w-full rounded-xl border border-input bg-transparent px-3 py-3 text-left shadow-sm transition-colors",
                  "hover:border-emerald-500/40 hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <UtensilsCrossed className="h-3.5 w-3.5" />
                    Открыть меню
                  </span>
                  {!asMode && menuGrandTotal > 0 && (
                    <span className="text-sm font-semibold tabular-nums text-emerald-700">
                      {formatMoney(menuGrandTotal)}
                    </span>
                  )}
                </div>
                {form.dishes.trim() ? (
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
                    {dishesPreview}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {asMode
                      ? "Нажмите, чтобы выбрать блюда (без обслуживания)…"
                      : pominkiMode
                        ? "Нажмите, чтобы выбрать блюда из меню на поминки…"
                        : "Нажмите, чтобы выбрать блюда из меню ресторана…"}
                  </p>
                )}
              </button>
              {!asMode && grandTotal > 0 && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <span>Блюда</span>
                    <span className="tabular-nums">{formatMoney(dishesSum)}</span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2">
                    <span>Обслуживание {BANQUET_SERVICE_CHARGE_PERCENT}%</span>
                    <span className="tabular-nums">{formatMoney(serviceSum)}</span>
                  </div>
                  <div className="mt-1 flex justify-between gap-2 font-semibold text-foreground">
                    <span>Итого с обслуживанием</span>
                    <span className="tabular-nums text-emerald-700">{formatMoney(grandTotal)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
                placeholder="Дополнительная информация"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BanquetMenuSheet
        open={menuOpen}
        value={form.dishes}
        onClose={() => setMenuOpen(false)}
        onSave={(serialized) => set("dishes")(serialized)}
        serviceCharge={!noService}
        initialTabId={pominkiMode ? "pominki" : asMode ? "as" : undefined}
      />

      <style>{`
        .rdp-banquets-calendar .rdp-day-has-event:not([data-selected="true"]) button,
        .rdp-banquets-calendar .rdp-day_hasEvent:not([aria-selected="true"]) {
          position: relative;
        }
        .rdp-banquets-calendar .rdp-day-has-event button::after,
        .rdp-banquets-calendar button.rdp-day-has-event::after {
          content: "";
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #1e3a5f;
        }
      `}</style>
    </div>
  );
}
