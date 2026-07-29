import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Trash2, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { Employee, TimesheetDaySummary, Workplace } from "@/api/types";
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

const WORKPLACE_LABEL: Record<Workplace, string> = {
  letnik: "Летник",
  bar: "Бар",
  banquet: "Банкет",
};

const WORKPLACE_SUMMARY: { key: Workplace; title: string }[] = [
  { key: "letnik", title: "На летнике" },
  { key: "bar", title: "В баре" },
  { key: "banquet", title: "На банкете" },
];

const TIME_OPTIONS = (() => {
  const options: string[] = [];
  for (let h = 6; h <= 23; h += 1) {
    for (const m of [0, 30]) {
      options.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return options;
})();

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMoney(value: string | number): string {
  const num = typeof value === "string" ? Number(value) : value;
  return `${Math.round(num).toLocaleString("ru-KZ")} ₸`;
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function isToday(iso: string): boolean {
  return iso === todayLocal();
}

export function TimesheetPage() {
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(todayLocal());
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
    start_time: "08:00",
    end_time: "16:00",
    workplace: "letnik" as Workplace,
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<Employee[]>("/employees"),
  });

  const { data: daySummary, isLoading: dayLoading } = useQuery({
    queryKey: ["timesheet", workDate],
    queryFn: () => apiFetch<TimesheetDaySummary>(`/timesheet?work_date=${workDate}`),
  });

  const shifts = daySummary?.shifts ?? [];

  const onShiftEmployees = useMemo(() => {
    const list = daySummary?.shifts ?? [];
    const ids = new Set(list.map((s) => s.employee_id));
    return employees.filter((e) => ids.has(e.id));
  }, [employees, daySummary]);

  const waitersByWorkplace = useMemo(() => {
    const groups: Record<Workplace, string[]> = {
      letnik: [],
      bar: [],
      banquet: [],
    };
    for (const shift of daySummary?.shifts ?? []) {
      if (!groups[shift.workplace].includes(shift.employee_name)) {
        groups[shift.workplace].push(shift.employee_name);
      }
    }
    return groups;
  }, [daySummary]);

  const resetEmployeeForm = () => {
    setEmployeeForm({ full_name: "", position: "официант", hourly_rate: "750" });
    setEditEmployee(null);
  };

  const resetShiftForm = () => {
    setShiftForm({
      employee_id: employees[0] ? String(employees[0].id) : "",
      start_time: "08:00",
      end_time: "16:00",
      workplace: "letnik",
    });
    setEditShiftId(null);
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
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
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
        work_date: workDate,
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
      toast.success(editShiftId ? "Смена обновлена" : "Смена добавлена");
      setShiftOpen(false);
      resetShiftForm();
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
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
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
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

  const openAddShift = () => {
    resetShiftForm();
    if (employees[0]) {
      setShiftForm((prev) => ({ ...prev, employee_id: String(employees[0].id) }));
    }
    setShiftOpen(true);
  };

  const openEditShift = (shift: TimesheetDaySummary["shifts"][number]) => {
    setEditShiftId(shift.id);
    setShiftForm({
      employee_id: String(shift.employee_id),
      start_time: shift.start_time,
      end_time: shift.end_time,
      workplace: shift.workplace,
    });
    setShiftOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Табель</h1>
          <p className="text-sm text-muted-foreground">
            Штат сотрудников, график смен и расходы на зарплату
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              className="w-[150px] border-0 p-0 shadow-none focus-visible:ring-0"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => setWorkDate(todayLocal())}>
            Сегодня
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              На смене {isToday(workDate) ? "сегодня" : formatDateLabel(workDate)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{shifts.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {onShiftEmployees.map((e) => e.full_name).join(", ") || "Никого не назначено"}
            </p>
          </CardContent>
        </Card>
        {WORKPLACE_SUMMARY.map(({ key, title }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              {waitersByWorkplace[key].length > 0 ? (
                <div className="space-y-1">
                  {waitersByWorkplace[key].map((name) => (
                    <div key={name} className="font-medium leading-snug">
                      {name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Никого не назначено</p>
              )}
            </CardContent>
          </Card>
        ))}
        <Card className="border-amber-200 bg-amber-50/50 sm:col-span-2 xl:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-900 flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Расход на зарплату
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-950">
              {daySummary ? formatMoney(daySummary.total_salary) : "0 ₸"}
            </div>
            <p className="text-xs text-amber-800/80 mt-1">
              Официанты — 750 ₸/час (настраивается у сотрудника)
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
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
          <div className="p-4 space-y-2 max-h-[520px] overflow-y-auto">
            {employeesLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Добавьте сотрудников — например, Андрей и Карим.
              </p>
            ) : (
              employees.map((employee) => (
                <div
                  key={employee.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2.5"
                >
                  <div>
                    <div className="font-medium">{employee.full_name}</div>
                    <div className="text-xs text-muted-foreground capitalize">
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

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="font-semibold">
                График на {isToday(workDate) ? "сегодня" : formatDateLabel(workDate)}
              </div>
              <p className="text-xs text-muted-foreground">
                Кто вышел на работу, часы и место (летник, бар, банкет)
              </p>
            </div>
            <Button size="sm" onClick={openAddShift} disabled={employees.length === 0}>
              <Plus className="h-4 w-4" />
              Добавить смену
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-4 py-3 font-medium">Сотрудник</th>
                  <th className="px-4 py-3 font-medium">Место</th>
                  <th className="px-4 py-3 font-medium">Время</th>
                  <th className="px-4 py-3 font-medium">Часы</th>
                  <th className="px-4 py-3 font-medium">Заработок</th>
                  <th className="px-4 py-3 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {dayLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Загрузка...
                    </td>
                  </tr>
                ) : shifts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      На эту дату смен нет. Нажмите «Добавить смену».
                    </td>
                  </tr>
                ) : (
                  shifts.map((shift) => (
                    <tr key={shift.id} className="border-b border-border/70">
                      <td className="px-4 py-3">
                        <div className="font-medium">{shift.employee_name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{shift.position}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{WORKPLACE_LABEL[shift.workplace]}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {shift.start_time} – {shift.end_time}
                      </td>
                      <td className="px-4 py-3">{Number(shift.hours_worked).toLocaleString("ru-KZ")}</td>
                      <td className="px-4 py-3 font-medium">{formatMoney(shift.earnings)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => openEditShift(shift)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            onClick={() => {
                              if (confirm("Удалить смену?")) deleteShift.mutate(shift.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {shifts.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/30 font-medium">
                    <td className="px-4 py-3" colSpan={3}>
                      Итого за день
                    </td>
                    <td className="px-4 py-3">
                      {daySummary ? Number(daySummary.total_hours).toLocaleString("ru-KZ") : "0"}
                    </td>
                    <td className="px-4 py-3">
                      {daySummary ? formatMoney(daySummary.total_salary) : "0 ₸"}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
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
            <DialogTitle>{editEmployee ? "Редактировать сотрудника" : "Добавить сотрудника"}</DialogTitle>
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
            <DialogTitle>{editShiftId ? "Редактировать смену" : "Добавить смену"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
