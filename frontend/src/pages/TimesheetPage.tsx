import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type {
  Employee,
  TimesheetShift,
  TimesheetWeekSummary,
  Workplace,
} from "@/api/types";
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
import { canManagePrices, useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

const WORKPLACE_LABEL: Record<Workplace, string> = {
  letnik: "Летник",
  bar: "Бар",
  banquet: "Банкет",
};

const WORKPLACE_STYLE: Record<Workplace, string> = {
  letnik: "border-emerald-200 bg-emerald-50 text-emerald-900",
  bar: "border-sky-200 bg-sky-50 text-sky-900",
  banquet: "border-amber-200 bg-amber-50 text-amber-950",
};

const TIME_OPTIONS = (() => {
  const options: string[] = [];
  for (let h = 6; h <= 23; h += 1) {
    for (const m of [0, 30]) {
      options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return options;
})();

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function todayLocal(): string {
  return toIsoDate(new Date());
}

function formatMoney(value: string | number): string {
  const num = typeof value === "string" ? Number(value) : value;
  return `${Math.round(num).toLocaleString("ru-KZ")} ₸`;
}

export function TimesheetPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = canManagePrices(user);

  const [monthAnchor, setMonthAnchor] = useState(todayLocal());
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editShiftId, setEditShiftId] = useState<number | null>(null);

  const [employeeForm, setEmployeeForm] = useState({
    full_name: "",
    position: "официант",
    hourly_rate: "750",
  });

  const [shiftForm, setShiftForm] = useState({
    employee_id: "",
    work_date: todayLocal(),
    start_time: "08:00",
    end_time: "16:00",
    workplace: "letnik" as Workplace,
  });

  const monthDate = useMemo(() => startOfMonth(parseISO(monthAnchor)), [monthAnchor]);
  const dateFrom = useMemo(() => toIsoDate(startOfMonth(monthDate)), [monthDate]);
  const dateTo = useMemo(() => toIsoDate(endOfMonth(monthDate)), [monthDate]);

  const calendarDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) => ({
      iso: toIsoDate(d),
      inMonth: isSameMonth(d, monthDate),
    }));
  }, [monthDate]);

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<Employee[]>("/employees"),
  });

  const { data: monthSummary, isLoading: monthLoading } = useQuery({
    queryKey: ["timesheet-month", dateFrom, dateTo],
    queryFn: () =>
      apiFetch<TimesheetWeekSummary>(
        `/timesheet/week?date_from=${dateFrom}&date_to=${dateTo}`,
      ),
  });

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, TimesheetShift[]>();
    for (const shift of monthSummary?.shifts ?? []) {
      const list = map.get(shift.work_date) ?? [];
      list.push(shift);
      map.set(shift.work_date, list);
    }
    return map;
  }, [monthSummary]);

  const resetEmployeeForm = () => {
    setEmployeeForm({ full_name: "", position: "официант", hourly_rate: "750" });
    setEditEmployee(null);
  };

  const resetShiftForm = (workDate = todayLocal()) => {
    setShiftForm({
      employee_id: employees[0] ? String(employees[0].id) : "",
      work_date: workDate,
      start_time: "08:00",
      end_time: "16:00",
      workplace: "letnik",
    });
    setEditShiftId(null);
  };

  const invalidateMonth = () => {
    void queryClient.invalidateQueries({ queryKey: ["timesheet-month"] });
    void queryClient.invalidateQueries({ queryKey: ["timesheet-week"] });
    void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
  };

  const saveEmployee = useMutation({
    mutationFn: () => {
      const body = {
        full_name: employeeForm.full_name.trim(),
        position: employeeForm.position.trim() || "официант",
        hourly_rate: employeeForm.hourly_rate || "750",
      };
      if (editEmployee) {
        return apiFetch(`/employees/${editEmployee.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return apiFetch("/employees", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(editEmployee ? "Сотрудник обновлён" : "Сотрудник добавлен");
      setEmployeeOpen(false);
      resetEmployeeForm();
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось сохранить сотрудника");
    },
  });

  const deleteEmployee = useMutation({
    mutationFn: (id: number) => apiFetch(`/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Сотрудник удалён из штата");
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
      invalidateMonth();
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось удалить сотрудника");
    },
  });

  const saveShift = useMutation({
    mutationFn: () => {
      const employeeId = Number(shiftForm.employee_id);
      const employee = employees.find((e) => e.id === employeeId);
      const body = {
        employee_id: employeeId,
        work_date: shiftForm.work_date,
        start_time: shiftForm.start_time,
        end_time: shiftForm.end_time,
        workplace: shiftForm.workplace,
        hourly_rate: employee?.hourly_rate ?? "750",
      };
      if (editShiftId) {
        return apiFetch(`/timesheet/${editShiftId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return apiFetch("/timesheet", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(editShiftId ? "Смена обновлена" : "Смена добавлена в ростер");
      setShiftOpen(false);
      resetShiftForm();
      invalidateMonth();
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось сохранить смену");
    },
  });

  const deleteShift = useMutation({
    mutationFn: (id: number) => apiFetch(`/timesheet/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Смена удалена");
      invalidateMonth();
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось удалить смену");
    },
  });

  const openAddEmployee = () => {
    resetEmployeeForm();
    setEmployeeOpen(true);
  };

  const openEditEmployee = (employee: Employee) => {
    setEditEmployee(employee);
    setEmployeeForm({
      full_name: employee.full_name,
      position: employee.position,
      hourly_rate: String(employee.hourly_rate),
    });
    setEmployeeOpen(true);
  };

  const openAddShift = (workDate: string) => {
    resetShiftForm(workDate);
    if (employees[0]) {
      setShiftForm((prev) => ({
        ...prev,
        work_date: workDate,
        employee_id: String(employees[0].id),
      }));
    }
    setShiftOpen(true);
  };

  const openEditShift = (shift: TimesheetShift) => {
    setEditShiftId(shift.id);
    setShiftForm({
      employee_id: String(shift.employee_id),
      work_date: shift.work_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      workplace: shift.workplace,
    });
    setShiftOpen(true);
  };

  const goPrevMonth = () => setMonthAnchor(toIsoDate(addMonths(monthDate, -1)));
  const goNextMonth = () => setMonthAnchor(toIsoDate(addMonths(monthDate, 1)));
  const goThisMonth = () => setMonthAnchor(todayLocal());

  const monthLabel = format(monthDate, "LLLL yyyy", { locale: ru });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Табель · ростер</h1>
          <p className="text-sm text-muted-foreground">
            {isOwner
              ? "Месячное расписание смен и расчёт зарплаты"
              : "Месячное расписание смен"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={goPrevMonth} aria-label="Прошлый месяц">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-center text-sm font-medium capitalize">
            {monthLabel}
          </div>
          <Button variant="outline" size="icon" onClick={goNextMonth} aria-label="Следующий месяц">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={goThisMonth}>
            Этот месяц
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-6",
          isOwner ? "xl:grid-cols-[280px_1fr]" : "grid-cols-1",
        )}
      >
        {isOwner && (
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4" />
                В штате
              </div>
              <Button size="sm" onClick={openAddEmployee}>
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
            <div className="max-h-[720px] space-y-2 overflow-y-auto p-4">
              {employeesLoading ? (
                <p className="text-sm text-muted-foreground">Загрузка...</p>
              ) : employees.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Добавьте сотрудников — затем ставьте их в ростер.
                </p>
              ) : (
                employees.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div>
                      <div className="font-medium">{employee.full_name}</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {employee.position} · {formatMoney(employee.hourly_rate)}/час
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => openEditEmployee(employee)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          if (confirm(`Удалить ${employee.full_name} из штата?`)) {
                            deleteEmployee.mutate(employee.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        <section className="min-w-0 space-y-4">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <div className="grid min-w-[980px] grid-cols-7 border-b border-border bg-muted/40">
              {WEEKDAY_SHORT.map((label) => (
                <div
                  key={label}
                  className="border-r border-border px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground last:border-r-0"
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="grid min-w-[980px] grid-cols-7">
              {calendarDays.map(({ iso, inMonth }) => {
                const dayShifts = inMonth ? shiftsByDay.get(iso) ?? [] : [];
                const isCurrent = iso === todayLocal();
                const dayNum = format(parseISO(iso), "d");
                return (
                  <div
                    key={iso}
                    className={cn(
                      "min-h-[140px] border-b border-r border-border p-1.5 last:border-r-0",
                      !inMonth && "bg-muted/20",
                      isCurrent && inMonth && "bg-emerald-50/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1 px-0.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                          !inMonth && "text-muted-foreground/50",
                          isCurrent && inMonth && "bg-emerald-600 text-white",
                        )}
                      >
                        {dayNum}
                      </span>
                      {inMonth && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={employees.length === 0}
                          onClick={() => openAddShift(iso)}
                          aria-label={`Добавить смену на ${iso}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      )}
                    </div>

                    {!inMonth ? null : monthLoading ? (
                      <p className="px-1 py-4 text-center text-[10px] text-muted-foreground">…</p>
                    ) : dayShifts.length === 0 ? (
                      <button
                        type="button"
                        disabled={employees.length === 0}
                        onClick={() => openAddShift(iso)}
                        className="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-border/70 px-1 py-3 text-[10px] text-muted-foreground transition-colors hover:border-emerald-400 hover:bg-emerald-50/40 disabled:pointer-events-none"
                      >
                        <Plus className="mb-0.5 h-3 w-3 opacity-40" />
                        Смена
                      </button>
                    ) : (
                      <ul className="space-y-1">
                        {dayShifts.map((shift) => (
                          <li key={shift.id}>
                            <button
                              type="button"
                              onClick={() => openEditShift(shift)}
                              className={cn(
                                "w-full rounded-md border px-1.5 py-1 text-left transition-shadow hover:shadow-sm",
                                WORKPLACE_STYLE[shift.workplace],
                              )}
                            >
                              <div className="truncate text-[11px] font-semibold leading-tight">
                                {shift.employee_name}
                              </div>
                              <div className="font-mono text-[10px] opacity-80">
                                {shift.start_time}–{shift.end_time}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-1">
                                <span className="truncate text-[9px] font-medium opacity-70">
                                  {WORKPLACE_LABEL[shift.workplace]}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  className="rounded p-0.5 opacity-50 hover:bg-black/5 hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm("Удалить смену?")) {
                                      deleteShift.mutate(shift.id);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.stopPropagation();
                                      if (confirm("Удалить смену?")) {
                                        deleteShift.mutate(shift.id);
                                      }
                                    }
                                  }}
                                  aria-label="Удалить смену"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </span>
                              </div>
                            </button>
                          </li>
                        ))}
                        <li>
                          <button
                            type="button"
                            disabled={employees.length === 0}
                            onClick={() => openAddShift(iso)}
                            className="flex w-full items-center justify-center gap-0.5 rounded-md border border-dashed border-border/60 py-0.5 text-[9px] text-muted-foreground hover:bg-muted/40"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            Ещё
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isOwner && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/40">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/70 px-4 py-3">
                <div className="flex items-center gap-2 font-semibold capitalize text-amber-950">
                  <Wallet className="h-4 w-4" />
                  Расчёт зарплаты · {monthLabel}
                </div>
                <div className="text-sm text-amber-900/80">
                  Итого:{" "}
                  <span className="text-lg font-bold text-amber-950">
                    {monthSummary ? formatMoney(monthSummary.total_salary) : "0 ₸"}
                  </span>
                  <span className="ml-2 text-xs">
                    · {monthSummary ? Number(monthSummary.total_hours).toLocaleString("ru-KZ") : "0"} ч
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto p-2">
                {(monthSummary?.by_employee.length ?? 0) === 0 ? (
                  <p className="px-3 py-6 text-sm text-amber-900/70">
                    За этот месяц смен нет — поставьте сотрудников в ростер.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-amber-900/60">
                        <th className="px-3 py-2 font-medium">Сотрудник</th>
                        <th className="px-3 py-2 font-medium">Смен</th>
                        <th className="px-3 py-2 font-medium">Часы</th>
                        <th className="px-3 py-2 font-medium">К выплате</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthSummary?.by_employee.map((row) => (
                        <tr key={row.employee_id} className="border-t border-amber-200/60">
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-amber-950">{row.employee_name}</div>
                            <div className="text-xs capitalize text-amber-900/60">{row.position}</div>
                          </td>
                          <td className="px-3 py-2.5">{row.shifts_count}</td>
                          <td className="px-3 py-2.5">
                            {Number(row.total_hours).toLocaleString("ru-KZ")}
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-amber-950">
                            {formatMoney(row.total_salary)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}
        </section>
      </div>

      <Dialog
        open={employeeOpen}
        onOpenChange={(open) => {
          setEmployeeOpen(open);
          if (!open) resetEmployeeForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editEmployee ? "Редактировать сотрудника" : "Добавить сотрудника"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>ФИО</Label>
              <Input
                value={employeeForm.full_name}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Андрей"
              />
            </div>
            <div>
              <Label>Должность</Label>
              <Input
                value={employeeForm.position}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, position: e.target.value }))}
                placeholder="официант"
              />
            </div>
            <div>
              <Label>Ставка, ₸/час</Label>
              <Input
                type="number"
                min={0}
                step={50}
                value={employeeForm.hourly_rate}
                onChange={(e) => setEmployeeForm((f) => ({ ...f, hourly_rate: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmployeeOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveEmployee.mutate()}
              disabled={!employeeForm.full_name.trim() || saveEmployee.isPending}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={shiftOpen}
        onOpenChange={(open) => {
          setShiftOpen(open);
          if (!open) resetShiftForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editShiftId ? "Редактировать смену" : "Добавить в ростер"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Дата</Label>
              <Input
                type="date"
                value={shiftForm.work_date}
                onChange={(e) => setShiftForm((f) => ({ ...f, work_date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Сотрудник</Label>
              <Select
                value={shiftForm.employee_id}
                onValueChange={(value) => setShiftForm((f) => ({ ...f, employee_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={String(employee.id)}>
                      {employee.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Начало</Label>
                <Select
                  value={shiftForm.start_time}
                  onValueChange={(value) => setShiftForm((f) => ({ ...f, start_time: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.map((time) => (
                      <SelectItem key={`start-${time}`} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Окончание</Label>
                <Select
                  value={shiftForm.end_time}
                  onValueChange={(value) => setShiftForm((f) => ({ ...f, end_time: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.map((time) => (
                      <SelectItem key={`end-${time}`} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Место работы</Label>
              <Select
                value={shiftForm.workplace}
                onValueChange={(value) =>
                  setShiftForm((f) => ({ ...f, workplace: value as Workplace }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WORKPLACE_LABEL) as Workplace[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {WORKPLACE_LABEL[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShiftOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveShift.mutate()}
              disabled={!shiftForm.employee_id || saveShift.isPending}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
