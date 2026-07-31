import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch } from "@/api/client";
import type { AnalyticsData } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, formatMoney } from "@/lib/format";

type Period = 7 | 30 | 90 | 365;

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 7, label: "7 дней" },
  { value: 30, label: "30 дней" },
  { value: 90, label: "90 дней" },
  { value: 365, label: "Год" },
];

const CHART_COLORS = {
  revenue: "#1e3a5f",
  salary: "#b45309",
  checkins: "#c9a227",
  checkouts: "#64748b",
  cash: "#16a34a",
  kaspi: "#ef4444",
  halyk: "#2563eb",
  other: "#94a3b8",
  booking: "#1e3a5f",
  extension: "#c9a227",
  alumni: "#0f766e",
};

function parseAmount(value: string): number {
  return parseFloat(value) || 0;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}`;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

const MAX_RANGE_DAYS = 7;

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>(30);
  const [range, setRange] = useState<DateRange | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const rangeFrom = range?.from;
  const rangeTo = range?.to ?? range?.from;

  const query =
    rangeFrom && rangeTo
      ? `/analytics?date_from=${toIsoDate(rangeFrom)}&date_to=${toIsoDate(rangeTo)}`
      : `/analytics?period=${period}`;

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", query],
    queryFn: () => apiFetch<AnalyticsData>(query),
  });

  const today = new Date();
  const rangeLabel = !rangeFrom || !rangeTo
    ? "Календарь"
    : isSameDay(rangeFrom, rangeTo)
      ? isSameDay(rangeFrom, today)
        ? "Сегодня"
        : shortLabel(rangeFrom)
      : `${shortLabel(rangeFrom)} – ${shortLabel(rangeTo)}`;

  const selectRange = (next: DateRange | undefined) => {
    // Clamp the range to at most 7 days.
    if (next?.from && next.to) {
      const diffDays = Math.round(
        (next.to.getTime() - next.from.getTime()) / 86_400_000,
      );
      if (diffDays >= MAX_RANGE_DAYS) {
        next = {
          from: next.from,
          to: new Date(next.from.getTime() + (MAX_RANGE_DAYS - 1) * 86_400_000),
        };
      }
    }
    setRange(next);
  };

  if (isLoading || !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-muted-foreground">
        Загрузка аналитики...
      </div>
    );
  }

  const { summary, daily, top_rooms, top_clients, salary_by_employee } = data;

  const revenueChart = daily.map((d) => ({
    date: shortDate(d.date),
    fullDate: d.date,
    revenue: parseAmount(d.revenue),
    salary: parseAmount(d.salary_expense),
    checkins: d.checkins,
    checkouts: d.checkouts,
  }));

  const paymentPie = [
    { name: "Наличка", value: parseAmount(summary.payments_by_method.cash), key: "cash" },
    { name: "Kaspi", value: parseAmount(summary.payments_by_method.kaspi), key: "kaspi" },
    { name: "Halyk", value: parseAmount(summary.payments_by_method.halyk), key: "halyk" },
    { name: "Другое", value: parseAmount(summary.payments_by_method.other), key: "other" },
  ].filter((item) => item.value > 0);

  const stayTypePie = [
    { name: "Брони", value: summary.bookings_count, key: "booking" },
    { name: "Продления", value: summary.extensions_count, key: "extension" },
    { name: "Встреча выпускников", value: summary.alumni_count ?? 0, key: "alumni" },
  ].filter((item) => item.value > 0);

  const roomsChart = top_rooms.map((r) => ({
    name: `№${r.room_number}`,
    revenue: parseAmount(r.revenue),
    stays: r.stays_count,
  }));

  const clientsChart = top_clients.slice(0, 5).map((c) => ({
    name: c.client_name.length > 14 ? `${c.client_name.slice(0, 14)}…` : c.client_name,
    revenue: parseAmount(c.revenue),
    visits: c.visits,
  }));

  const salaryChart = salary_by_employee.map((e) => ({
    name: e.employee_name.length > 12 ? `${e.employee_name.slice(0, 12)}…` : e.employee_name,
    earnings: parseAmount(e.earnings),
    hours: parseAmount(e.hours_worked),
    shifts: e.shifts_count,
  }));

  const pieColors: Record<string, string> = {
    cash: CHART_COLORS.cash,
    kaspi: CHART_COLORS.kaspi,
    halyk: CHART_COLORS.halyk,
    other: CHART_COLORS.other,
    booking: CHART_COLORS.booking,
    extension: CHART_COLORS.extension,
    alumni: CHART_COLORS.alumni,
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Аналитика</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(summary.date_from)} — {formatDate(summary.date_to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={!rangeFrom && period === opt.value ? "default" : "outline"}
              onClick={() => {
                setRange(undefined);
                setPeriod(opt.value);
              }}
            >
              {opt.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={
              rangeFrom && rangeTo && isSameDay(rangeFrom, today) && isSameDay(rangeTo, today)
                ? "default"
                : "outline"
            }
            onClick={() => setRange({ from: today, to: today })}
          >
            Сегодня
          </Button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant={rangeFrom ? "default" : "outline"}>
                <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
                {rangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto">
              <Calendar
                mode="range"
                selected={range}
                onSelect={selectRange}
                max={MAX_RANGE_DAYS - 1}
                disabled={{ after: today }}
                defaultMonth={rangeFrom ?? today}
              />
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Одна дата или период до 7 дней
                </p>
                <Button size="sm" variant="ghost" onClick={() => setRange(undefined)}>
                  Сбросить
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          { label: "Выручка", value: formatMoney(summary.total_revenue) },
          { label: "Отель", value: formatMoney(summary.hotel_revenue) },
          { label: "Банкеты", value: formatMoney(summary.banquet_revenue) },
          { label: "На вынос", value: formatMoney(summary.takeaway_revenue) },
          { label: "Сауна / баня", value: formatMoney(summary.spa_revenue) },
          { label: "Средняя / день", value: formatMoney(summary.avg_daily_revenue) },
          { label: "Зарплата официантов", value: formatMoney(summary.total_salary_expense) },
          { label: "Долг", value: formatMoney(summary.unpaid_amount) },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="text-xl font-semibold">{item.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Выручка и зарплата по дням</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(value, name) => [formatMoney(Number(value ?? 0)), String(name)]}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullDate
                      ? formatDate(payload[0].payload.fullDate)
                      : ""
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART_COLORS.revenue}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Выручка"
                />
                <Line
                  type="monotone"
                  dataKey="salary"
                  stroke={CHART_COLORS.salary}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="Зарплата"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Заселения и выезды</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.fullDate
                      ? formatDate(payload[0].payload.fullDate)
                      : ""
                  }
                />
                <Legend />
                <Bar dataKey="checkins" name="Заселения" fill={CHART_COLORS.checkins} radius={[4, 4, 0, 0]} />
                <Bar dataKey="checkouts" name="Выезды" fill={CHART_COLORS.checkouts} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Способы оплаты</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {paymentPie.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Нет оплат за период
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentPie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                  >
                    {paymentPie.map((entry) => (
                      <Cell key={entry.key} fill={pieColors[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(Number(value ?? 0))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Брони vs продления</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {stayTypePie.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Нет записей за период
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stayTypePie}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {stayTypePie.map((entry) => (
                      <Cell key={entry.key} fill={pieColors[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Сводка оплат</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Отель</span>
              <span className="font-medium">{formatMoney(summary.hotel_revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Банкеты</span>
              <span className="font-medium">{formatMoney(summary.banquet_revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">На вынос</span>
              <span className="font-medium">{formatMoney(summary.takeaway_revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Сауна / баня</span>
              <span className="font-medium">{formatMoney(summary.spa_revenue)}</span>
            </div>
            <div className="border-t border-border pt-3" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Наличка</span>
              <span className="font-medium">{formatMoney(summary.payments_by_method.cash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kaspi</span>
              <span className="font-medium">{formatMoney(summary.payments_by_method.kaspi)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Halyk</span>
              <span className="font-medium">{formatMoney(summary.payments_by_method.halyk)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Другое</span>
              <span className="font-medium">{formatMoney(summary.payments_by_method.other)}</span>
            </div>
            <div className="border-t border-border pt-3">
              <div className="flex justify-between text-destructive">
                <span>Неоплачено ({summary.unpaid_count})</span>
                <span className="font-medium">{formatMoney(summary.unpaid_amount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Зарплата официантов по сотрудникам</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {salaryChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Нет смен в табеле за период
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salaryChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "Заработок"
                        ? formatMoney(Number(value ?? 0))
                        : `${Number(value ?? 0).toLocaleString("ru-KZ")} ч`
                    }
                  />
                  <Legend />
                  <Bar dataKey="earnings" name="Заработок" fill={CHART_COLORS.salary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="hours" name="Часы" fill={CHART_COLORS.checkins} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Расходы на зарплату</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Всего за период</span>
              <span className="font-medium text-amber-900">
                {formatMoney(summary.total_salary_expense)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">В среднем в день</span>
              <span className="font-medium">{formatMoney(summary.avg_daily_salary)}</span>
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              {salary_by_employee.length === 0 ? (
                <p className="text-muted-foreground">Данные из табеля отсутствуют</p>
              ) : (
                salary_by_employee.map((employee) => (
                  <div key={employee.employee_name} className="flex justify-between gap-3">
                    <div>
                      <div className="font-medium">{employee.employee_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {employee.position} · {employee.shifts_count} смен ·{" "}
                        {Number(employee.hours_worked).toLocaleString("ru-KZ")} ч
                      </div>
                    </div>
                    <span className="font-medium shrink-0">{formatMoney(employee.earnings)}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ номеров по выручке</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {roomsChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Нет данных
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roomsChart} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={50} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatMoney(Number(value ?? 0))} />
                  <Bar dataKey="revenue" name="Выручка" fill={CHART_COLORS.revenue} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Топ клиентов</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {clientsChart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Нет данных
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clientsChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) =>
                      name === "Выручка" ? formatMoney(Number(value ?? 0)) : Number(value ?? 0)
                    }
                  />
                  <Legend />
                  <Bar dataKey="revenue" name="Выручка" fill={CHART_COLORS.revenue} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="visits" name="Визиты" fill={CHART_COLORS.checkins} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
