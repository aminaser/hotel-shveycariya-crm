import { useQuery } from "@tanstack/react-query";
import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { apiFetch } from "@/api/client";
import type { Banquet, Stay } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type SpaBooking,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";

type EventKind = "banquet" | "spa" | "checkin" | "checkout";

interface CalendarEvent {
  id: string;
  kind: EventKind;
  date: string; // YYYY-MM-DD
  time: string | null;
  title: string;
  subtitle: string | null;
  href: string;
}

const KIND_LABEL: Record<EventKind, string> = {
  banquet: "Банкет",
  spa: "Сауна / баня",
  checkin: "Заезд",
  checkout: "Выезд",
};

const KIND_BADGE: Record<EventKind, "default" | "success" | "warning" | "muted"> = {
  banquet: "warning",
  spa: "success",
  checkin: "default",
  checkout: "muted",
};

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

function formatTime(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

async function fetchSpaRange(from: string, to: string): Promise<SpaBooking[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("spa_bookings")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .gte("booking_date", from)
    .lte("booking_date", to)
    .order("booking_date", { ascending: true })
    .order("slot_time", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SpaBooking[];
}

function buildEvents(
  banquets: Banquet[],
  stays: Stay[],
  spa: SpaBooking[],
  rangeFrom: string,
  rangeTo: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const b of banquets) {
    events.push({
      id: `banquet-${b.id}`,
      kind: "banquet",
      date: b.event_date,
      time: b.event_time,
      title: b.guest_name,
      subtitle: [b.venue, b.event_type, b.people_count ? `${b.people_count} чел.` : null]
        .filter(Boolean)
        .join(" · "),
      href: "/banquets",
    });
  }

  for (const s of spa) {
    events.push({
      id: `spa-${s.id}`,
      kind: "spa",
      date: s.booking_date,
      time: s.slot_time,
      title: s.guest_name,
      subtitle: [
        s.service === "banya" ? "Русская баня" : "Финская сауна",
        s.room ? `номер ${s.room}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/spa",
    });
  }

  for (const stay of stays) {
    if (stay.check_in && stay.check_in >= rangeFrom && stay.check_in <= rangeTo) {
      events.push({
        id: `checkin-${stay.id}`,
        kind: "checkin",
        date: stay.check_in,
        time: null,
        title: stay.client_name,
        subtitle: `Номер ${stay.room_number}`,
        href: "/registry",
      });
    }
    const departure = stay.planned_check_out ?? stay.check_out;
    if (departure && departure >= rangeFrom && departure <= rangeTo) {
      events.push({
        id: `checkout-${stay.id}`,
        kind: "checkout",
        date: departure,
        time: null,
        title: stay.client_name,
        subtitle: `Номер ${stay.room_number}`,
        href: "/registry",
      });
    }
  }

  return events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.time ?? "";
    const tb = b.time ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.title.localeCompare(b.title, "ru");
  });
}

export function CalendarPage() {
  const today = startOfDay(new Date());
  const [selected, setSelected] = useState<Date>(today);

  const rangeFrom = toIsoDate(addDays(today, -7));
  const rangeTo = toIsoDate(addDays(today, 60));

  const { data: banquets = [], isLoading: banquetsLoading } = useQuery({
    queryKey: ["banquets", "calendar", rangeFrom, rangeTo],
    queryFn: () =>
      apiFetch<Banquet[]>(`/banquets?date_from=${rangeFrom}&date_to=${rangeTo}`),
  });

  // Look back further than the visible calendar: check-out dates can fall
  // inside the window while record_date is weeks earlier.
  const stayRangeFrom = toIsoDate(addDays(today, -90));
  const { data: stays = [], isLoading: staysLoading } = useQuery({
    queryKey: ["stays", "calendar", stayRangeFrom, rangeTo],
    queryFn: () =>
      apiFetch<Stay[]>(`/stays?date_from=${stayRangeFrom}&date_to=${rangeTo}`),
  });

  const { data: spa = [], isLoading: spaLoading } = useQuery({
    queryKey: ["spa-bookings", "calendar", rangeFrom, rangeTo],
    queryFn: () => fetchSpaRange(rangeFrom, rangeTo),
    enabled: isSupabaseConfigured,
  });

  const events = useMemo(
    () => buildEvents(banquets, stays, spa, rangeFrom, rangeTo),
    [banquets, stays, spa, rangeFrom, rangeTo],
  );

  const datesWithEvents = useMemo(() => {
    const set = new Set(events.map((e) => e.date));
    return [...set].map((iso) => parseISO(iso));
  }, [events]);

  const selectedIso = toIsoDate(selected);
  const dayEvents = events.filter((e) => e.date === selectedIso);

  const upcoming = useMemo(() => {
    const end = toIsoDate(addDays(today, 7));
    const todayIso = toIsoDate(today);
    return events.filter((e) => e.date >= todayIso && e.date <= end);
  }, [events, today]);

  const isLoading = banquetsLoading || staysLoading || spaLoading;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarDays className="h-6 w-6" />
          Календарь
        </h1>
        <p className="text-sm text-muted-foreground">
          Брони банкетов, сауны/бани, заезды и выезды — с напоминаниями на выбранный день.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <Card className="w-fit">
          <CardContent className="p-4">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(d) => d && setSelected(d)}
              defaultMonth={selected}
              modifiers={{ hasEvent: datesWithEvents }}
              modifiersClassNames={{
                hasEvent: "rdp-day-has-event font-semibold text-primary",
              }}
              className="rdp-calendar-page"
            />
            <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                Есть бронь
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                onClick={() => setSelected(today)}
              >
                Сегодня
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {isSameDay(selected, today) ? "Сегодня" : formatRuDate(selectedIso)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {isLoading
                  ? "Загрузка…"
                  : dayEvents.length === 0
                    ? "На этот день броней нет"
                    : `${dayEvents.length} напоминани${dayEvents.length === 1 ? "е" : dayEvents.length < 5 ? "я" : "й"}`}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {dayEvents.map((event) => (
                <Link
                  key={event.id}
                  to={event.href}
                  className={cn(
                    "block rounded-lg border border-border p-3 transition-colors hover:bg-muted/40",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={KIND_BADGE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
                    {event.time && (
                      <span className="text-sm font-medium">{formatTime(event.time)}</span>
                    )}
                    <span className="font-medium">{event.title}</span>
                  </div>
                  {event.subtitle && (
                    <div className="mt-1 text-sm text-muted-foreground">{event.subtitle}</div>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Напоминания на 7 дней</CardTitle>
              <p className="text-sm text-muted-foreground">
                Ближайшие бронирования, заезды и выезды
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.length === 0 && !isLoading && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  В ближайшие дни напоминаний нет
                </p>
              )}
              {upcoming.map((event) => (
                <button
                  key={`up-${event.id}`}
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  onClick={() => setSelected(parseISO(event.date))}
                >
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {format(parseISO(event.date), "d MMM", { locale: ru })}
                    {event.time ? `, ${formatTime(event.time)}` : ""}
                  </span>
                  <Badge variant={KIND_BADGE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
                  <span className="font-medium">{event.title}</span>
                  {event.subtitle && (
                    <span className="text-muted-foreground">· {event.subtitle}</span>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <style>{`
        .rdp-calendar-page .rdp-day-has-event:not([data-selected="true"]) button,
        .rdp-calendar-page .rdp-day_hasEvent:not([aria-selected="true"]) {
          position: relative;
        }
        .rdp-calendar-page .rdp-day-has-event button::after,
        .rdp-calendar-page button.rdp-day-has-event::after {
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
