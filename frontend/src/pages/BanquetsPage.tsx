import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PartyPopper, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type { Banquet, PaymentStatus } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { BanquetMenuSheet } from "@/components/BanquetMenuSheet";
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

/** Fixed «Ас» package: N people × 3000 ₸, no service charge. */
const AS_VENUE = "Ас";
const AS_PRICE_PER_PERSON = 3000;
/** «Поминки»: venue locked, menu + 10% обслуживание. */
const POMINKI_VENUE = "Поминки";

type BookingKind = "normal" | "as" | "pominki";

interface BanquetForm {
  event_date: string;
  event_time: string;
  guest_name: string;
  phone: string;
  venue: string;
  people_count: string;
  event_type: string;
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  payment_method_preset: PaymentMethodPreset | string;
  payment_method_custom: string;
  payment_date: string;
  dishes: string;
  notes: string;
}

function isAsBooking(venue: string): boolean {
  return venue.trim().toLowerCase() === AS_VENUE.toLowerCase();
}

function isPominkiBooking(venue: string): boolean {
  return venue.trim().toLowerCase() === POMINKI_VENUE.toLowerCase();
}

function asPackageTotal(peopleCount: string | number): number {
  const n =
    typeof peopleCount === "number"
      ? peopleCount
      : Math.max(1, parseInt(peopleCount, 10) || 1);
  return n * AS_PRICE_PER_PERSON;
}

function inferPaymentStatus(b: Banquet): PaymentStatus {
  if (b.payment_status === "paid" || b.payment_status === "partial" || b.payment_status === "unpaid") {
    return b.payment_status;
  }
  const prepaid = parseFloat(b.prepayment || "0");
  if (prepaid <= 0) return "unpaid";
  if (isAsBooking(b.venue ?? "")) {
    const total = asPackageTotal(b.people_count);
    if (prepaid >= total) return "paid";
    return "partial";
  }
  return "paid";
}

function emptyForm(kind: BookingKind = "normal"): BanquetForm {
  const asPackage = kind === "as";
  const pominki = kind === "pominki";
  return {
    event_date: todayLocal(),
    event_time: "",
    guest_name: "",
    phone: "",
    venue: asPackage ? AS_VENUE : pominki ? POMINKI_VENUE : "",
    people_count: "10",
    event_type: pominki ? POMINKI_VENUE : "",
    payment_amount: asPackage ? String(asPackageTotal(10)) : "",
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
  const asMode = isAsBooking(b.venue ?? "");
  const status = inferPaymentStatus(b);
  const amount =
    b.payment_amount && parseFloat(b.payment_amount) > 0
      ? b.payment_amount
      : asMode
        ? String(asPackageTotal(b.people_count))
        : b.prepayment && parseFloat(b.prepayment) > 0
          ? b.prepayment
          : "";
  return {
    event_date: b.event_date,
    event_time: b.event_time ?? "",
    guest_name: b.guest_name,
    phone: b.phone ?? "",
    venue: b.venue ?? "",
    people_count: String(b.people_count),
    event_type: b.event_type ?? "",
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editBanquet, setEditBanquet] = useState<Banquet | null>(null);
  const [form, setForm] = useState<BanquetForm>(emptyForm());
  const [authorId, setAuthorId] = useState<number | null>(null);

  const asMode = isAsBooking(form.venue);
  const pominkiMode = isPominkiBooking(form.venue);
  const noService = asMode;
  const asTotal = asPackageTotal(form.people_count);
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

  const set = (field: keyof BanquetForm) => (value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const openCreate = () => {
    setEditBanquet(null);
    setForm(emptyForm("normal"));
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const openAsCreate = () => {
    setEditBanquet(null);
    setForm(emptyForm("as"));
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const openPominkiCreate = () => {
    setEditBanquet(null);
    setForm(emptyForm("pominki"));
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (b: Banquet) => {
    setEditBanquet(b);
    setForm(toForm(b));
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const buildPayload = () => {
    const people = Math.max(1, parseInt(form.people_count, 10) || 1);
    const total = asMode
      ? people * AS_PRICE_PER_PERSON
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
      venue: asMode ? AS_VENUE : pominkiMode ? POMINKI_VENUE : form.venue.trim() || null,
      people_count: people,
      event_type: pominkiMode
        ? form.event_type.trim() || POMINKI_VENUE
        : form.event_type.trim() || null,
      payment_amount: String(total),
      prepayment,
      payment_status: form.payment_status,
      payment_method: received
        ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
        : null,
      payment_date: received ? form.payment_date || todayLocal() : null,
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
          <h1 className="text-2xl font-bold">Банкеты</h1>
          <p className="text-sm text-muted-foreground">
            Журнал бронирования банкетов и мероприятий
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
          <Button
            type="button"
            variant="outline"
            className="border-emerald-600/50 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
            onClick={openAsCreate}
          >
            <PartyPopper className="h-4 w-4" />
            Ас · 3000 ₸/чел
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-slate-500/40 bg-slate-50 text-slate-900 hover:bg-slate-100"
            onClick={openPominkiCreate}
          >
            <UtensilsCrossed className="h-4 w-4" />
            Поминки
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Добавить бронирование
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Загрузка...</p>
      ) : banquets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
          <PartyPopper className="h-8 w-8" />
          <p>Пока нет бронирований — добавьте первое</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-emerald-600/50 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
              onClick={openAsCreate}
            >
              Ас · 3000 ₸/чел
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-slate-500/40 bg-slate-50 text-slate-900 hover:bg-slate-100"
              onClick={openPominkiCreate}
            >
              Поминки
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Добавить бронирование
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Время</th>
                <th className="px-4 py-3">ФИО</th>
                <th className="px-4 py-3">Телефон</th>
                <th className="px-4 py-3">Место</th>
                <th className="px-4 py-3">Чел.</th>
                <th className="px-4 py-3">Мероприятие</th>
                <th className="px-4 py-3">Оплата</th>
                <th className="px-4 py-3">Способ</th>
                <th className="px-4 py-3">Дата оплаты</th>
                <th className="px-4 py-3">Блюда</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {banquets.map((b) => (
                <tr key={b.id} className="border-b border-border align-top last:border-b-0">
                  <td className="px-4 py-3 font-medium">{formatDate(b.event_date)}</td>
                  <td className="px-4 py-3">{b.event_time ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    {b.guest_name}
                    <AuthorshipMeta
                      className="mt-1 font-normal"
                      createdByName={b.created_by_name}
                      createdAt={b.created_at}
                      updatedByName={b.updated_by_name}
                      updatedAt={b.updated_at}
                    />
                  </td>
                  <td className="px-4 py-3">{b.phone ?? "—"}</td>
                  <td className="px-4 py-3">{b.venue ?? "—"}</td>
                  <td className="px-4 py-3">{b.people_count}</td>
                  <td className="px-4 py-3">
                    {b.event_type ? <Badge variant="muted">{b.event_type}</Badge> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const status = inferPaymentStatus(b);
                      const total =
                        parseFloat(b.payment_amount || "0") ||
                        (isAsBooking(b.venue ?? "")
                          ? asPackageTotal(b.people_count)
                          : parseFloat(b.prepayment || "0") || 0);
                      return (
                        <div className="space-y-0.5">
                          {total > 0 ? (
                            <div className="font-medium tabular-nums">
                              {formatMoney(total)}
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            {paymentStatusLabel[status]}
                            {status === "partial"
                              ? ` · ${formatMoney(b.prepayment)}`
                              : ""}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">{formatPaymentMethod(b.payment_method)}</td>
                  <td className="px-4 py-3">
                    {b.payment_date ? formatDate(b.payment_date) : "—"}
                  </td>
                  <td className="max-w-[280px] whitespace-pre-line px-4 py-3 text-xs text-muted-foreground">
                    {formatDishesPreview(b.dishes, {
                      serviceCharge: !isAsBooking(b.venue ?? ""),
                    })}
                    {b.notes ? (
                      <p className="mt-1 text-foreground/80">{b.notes}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                        venue: AS_VENUE,
                        event_type: "",
                        payment_amount: String(asPackageTotal(p.people_count)),
                        payment_status: "unpaid",
                        prepayment: "",
                      }))
                    }
                  >
                    Ас · 3000 ₸/чел без обслуживания
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-slate-500/40 text-slate-800"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        venue: POMINKI_VENUE,
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
                  onChange={(e) => set("people_count")(e.target.value)}
                />
              </div>
            </div>

            {asMode ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    Сумма оплаты ({AS_PRICE_PER_PERSON.toLocaleString("ru-KZ")} ₸ ×{" "}
                    {Math.max(1, parseInt(form.people_count, 10) || 1)} чел.)
                  </span>
                  <span className="font-semibold tabular-nums text-emerald-700">
                    {formatMoney(asTotal)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Без обслуживания
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Входит: Плов без мяса, Витаминный, Пекин без мяса, Лепешки,
                  Баурсаки, Самса песочная
                </p>
              </div>
            ) : (
              <>
                {!pominkiMode && (
                  <>
                    <div className="space-y-2">
                      <Label>Место проведения</Label>
                      <Input
                        value={form.venue}
                        onChange={(e) => set("venue")(e.target.value)}
                        placeholder="Банкетный зал / летняя терраса…"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Тип мероприятия</Label>
                      <Input
                        value={form.event_type}
                        onChange={(e) => set("event_type")(e.target.value)}
                        placeholder="Свадьба, юбилей, корпоратив…"
                      />
                    </div>
                  </>
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
                  setForm((p) => ({
                    ...p,
                    payment_status,
                    payment_date:
                      payment_status === "unpaid"
                        ? ""
                        : p.payment_date || todayLocal(),
                    prepayment: payment_status === "partial" ? p.prepayment : "",
                  }));
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
                  onChange={(e) => set("prepayment")(e.target.value)}
                  placeholder="Предоплата"
                />
                {paymentTotal > 0 && parseFloat(form.prepayment || "0") > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Остаток:{" "}
                    {formatMoney(
                      Math.max(
                        0,
                        paymentTotal - (parseFloat(form.prepayment) || 0),
                      ),
                    )}
                  </p>
                )}
              </div>
            )}
            {form.payment_status !== "unpaid" && (
              <>
                <div className="space-y-2">
                  <Label>Дата оплаты</Label>
                  <Input
                    type="date"
                    value={form.payment_date}
                    onChange={(e) => set("payment_date")(e.target.value)}
                  />
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
    </div>
  );
}
