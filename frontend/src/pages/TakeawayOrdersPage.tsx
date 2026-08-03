import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type {
  PaymentStatus,
  TakeawayFulfillmentStatus,
  TakeawayOrder,
} from "@/api/types";
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
import { dishesTotal, formatDishesPreview, parseDishes } from "@/lib/banquet-dishes";
import { todayLocal } from "@/lib/dates";
import { formatDate, formatMoney, paymentStatusLabel } from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
  type PaymentMethodPreset,
} from "@/lib/payment-method";
import { cn } from "@/lib/utils";

const FULFILLMENT_LABEL: Record<TakeawayFulfillmentStatus, string> = {
  waiting: "Ожидает",
  picked_up: "Забрали",
};

function normalizeFulfillment(
  value: string | null | undefined,
): TakeawayFulfillmentStatus {
  return value === "picked_up" ? "picked_up" : "waiting";
}

interface TakeawayForm {
  order_date: string;
  order_time: string;
  guest_name: string;
  phone: string;
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  fulfillment_status: TakeawayFulfillmentStatus;
  payment_method_preset: PaymentMethodPreset | string;
  payment_method_custom: string;
  payment_date: string;
  dishes: string;
}

function emptyForm(): TakeawayForm {
  return {
    order_date: todayLocal(),
    order_time: "",
    guest_name: "",
    phone: "",
    payment_amount: "",
    prepayment: "",
    payment_status: "unpaid",
    fulfillment_status: "waiting",
    payment_method_preset: "cash",
    payment_method_custom: "",
    payment_date: "",
    dishes: "",
  };
}

function inferTakeawayStatus(o: TakeawayOrder, dishesSum: number): PaymentStatus {
  const prepaid = parseFloat(o.prepayment || "0") || 0;
  if (prepaid <= 0) return "unpaid";
  if (dishesSum > 0 && prepaid < dishesSum) return "partial";
  return "paid";
}

function toForm(o: TakeawayOrder): TakeawayForm {
  const { preset, customText } = splitPaymentMethod(o.payment_method);
  const dishesSum = dishesTotal(parseDishes(o.dishes).items);
  const prepaid = parseFloat(o.prepayment || "0") || 0;
  const status = inferTakeawayStatus(o, dishesSum);
  const total =
    dishesSum > 0
      ? String(Math.round(dishesSum))
      : prepaid > 0
        ? String(Math.round(prepaid))
        : "";
  return {
    order_date: o.order_date,
    order_time: o.order_time ?? "",
    guest_name: o.guest_name,
    phone: o.phone ?? "",
    payment_amount: total,
    prepayment: status === "partial" && prepaid > 0 ? String(Math.round(prepaid)) : "",
    payment_status: status,
    fulfillment_status: normalizeFulfillment(o.fulfillment_status),
    payment_method_preset: preset,
    payment_method_custom: customText,
    payment_date: o.payment_date ?? "",
    dishes: o.dishes ?? "",
  };
}

export function TakeawayOrdersPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<TakeawayOrder | null>(null);
  const [form, setForm] = useState<TakeawayForm>(emptyForm());
  const [authorId, setAuthorId] = useState<number | null>(null);

  const dishesPreview = formatDishesPreview(form.dishes || null);
  const dishesSum = dishesTotal(parseDishes(form.dishes).items);
  const paymentTotal =
    dishesSum > 0 ? dishesSum : parseFloat(form.payment_amount || "0") || 0;

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["takeaway-orders", authorId],
    queryFn: () => {
      const qs = authorId != null ? `?author_id=${authorId}` : "";
      return apiFetch<TakeawayOrder[]>(`/takeaway-orders${qs}`);
    },
    // Backend auto-flips overdue waiting → picked_up on each list.
    refetchInterval: 30_000,
  });

  const set = (field: keyof TakeawayForm) => (value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const openCreate = () => {
    setEditOrder(null);
    setForm(emptyForm());
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (o: TakeawayOrder) => {
    setEditOrder(o);
    setForm(toForm(o));
    setMenuOpen(false);
    setDialogOpen(true);
  };

  const buildPayload = () => {
    const total = paymentTotal;
    let prepayment = "0";
    if (form.payment_status === "partial") {
      prepayment = form.prepayment.trim() || "0";
    } else if (form.payment_status === "paid") {
      prepayment = String(total > 0 ? Math.round(total) : 0);
    }
    const paid = form.payment_status !== "unpaid";
    return {
      order_date: form.order_date,
      order_time: form.order_time.trim() || null,
      guest_name: form.guest_name.trim(),
      phone: form.phone.trim() || null,
      prepayment,
      payment_method: paid
        ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
        : null,
      payment_date: paid
        ? form.payment_date ||
          (form.payment_status === "partial"
            ? paymentDateForEvent(form.order_date, todayLocal())
            : todayLocal())
        : null,
      fulfillment_status: form.fulfillment_status,
      dishes: form.dishes.trim() || null,
    };
  };

  const validate = (): boolean => {
    if (!form.guest_name.trim()) {
      toast.error("Укажите ФИО / имя");
      return false;
    }
    if (!form.order_date) {
      toast.error("Укажите дату заказа");
      return false;
    }
    if (form.payment_status === "partial") {
      const prepaid = parseFloat(form.prepayment || "0");
      if (!(prepaid > 0)) {
        toast.error("Укажите сумму предоплаты");
        return false;
      }
      if (paymentTotal > 0 && prepaid >= paymentTotal) {
        toast.error("Предоплата должна быть меньше общей суммы");
        return false;
      }
    }
    if (form.payment_status === "paid" && !(paymentTotal > 0)) {
      toast.error("Укажите общую сумму или выберите блюда");
      return false;
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
      return editOrder
        ? apiFetch(`/takeaway-orders/${editOrder.id}`, {
            method: "PATCH",
            body: JSON.stringify(buildPayload()),
          })
        : apiFetch("/takeaway-orders", {
            method: "POST",
            body: JSON.stringify(buildPayload()),
          });
    },
    onSuccess: () => {
      toast.success(editOrder ? "Заказ обновлён" : "Заказ добавлен");
      setDialogOpen(false);
      setEditOrder(null);
      queryClient.invalidateQueries({ queryKey: ["takeaway-orders"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => onError(e, "Не удалось сохранить"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/takeaway-orders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Заказ перемещён в корзину");
      queryClient.invalidateQueries({ queryKey: ["takeaway-orders"] });
      queryClient.invalidateQueries({ queryKey: ["crm-trash"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (e) => onError(e, "Не удалось удалить"),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      fulfillment_status,
    }: {
      id: number;
      fulfillment_status: TakeawayFulfillmentStatus;
    }) =>
      apiFetch(`/takeaway-orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fulfillment_status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["takeaway-orders"] });
    },
    onError: (e) => onError(e, "Не удалось сменить статус"),
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">На вынос</h1>
          <p className="text-sm text-muted-foreground">
            Заказы на вынос из отдельного меню · без обслуживания
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Добавить заказ
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Загрузка...</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
          <ShoppingBag className="h-8 w-8" />
          <p>Пока нет заказов — добавьте первый</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Время</th>
                <th className="px-4 py-3">Клиент</th>
                <th className="px-4 py-3">Телефон</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Оплата</th>
                <th className="px-4 py-3">Способ</th>
                <th className="px-4 py-3">Дата оплаты</th>
                <th className="px-4 py-3">Блюда</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const sum = dishesTotal(parseDishes(o.dishes).items);
                const status = inferTakeawayStatus(o, sum);
                const prepaid = parseFloat(o.prepayment || "0") || 0;
                const fulfillment = normalizeFulfillment(o.fulfillment_status);
                return (
                  <tr key={o.id} className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3 font-medium">{formatDate(o.order_date)}</td>
                    <td className="px-4 py-3">{o.order_time ?? "—"}</td>
                    <td className="px-4 py-3 font-medium">
                      {o.guest_name}
                      <AuthorshipMeta
                        className="mt-1 font-normal"
                        createdByName={o.created_by_name}
                        createdAt={o.created_at}
                        updatedByName={o.updated_by_name}
                        updatedAt={o.updated_at}
                      />
                    </td>
                    <td className="px-4 py-3">{o.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Select
                        value={fulfillment}
                        onValueChange={(v) =>
                          statusMutation.mutate({
                            id: o.id,
                            fulfillment_status: v as TakeawayFulfillmentStatus,
                          })
                        }
                        disabled={statusMutation.isPending}
                      >
                        <SelectTrigger className="h-8 w-[140px] border-0 bg-transparent px-0 shadow-none focus:ring-0">
                          <SelectValue>
                            <Badge
                              variant={
                                fulfillment === "picked_up" ? "success" : "warning"
                              }
                            >
                              {FULFILLMENT_LABEL[fulfillment]}
                            </Badge>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="waiting">
                            <Badge variant="warning">{FULFILLMENT_LABEL.waiting}</Badge>
                          </SelectItem>
                          <SelectItem value="picked_up">
                            <Badge variant="success">
                              {FULFILLMENT_LABEL.picked_up}
                            </Badge>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      {status === "unpaid" ? (
                        <span className="text-muted-foreground">
                          {paymentStatusLabel.unpaid}
                        </span>
                      ) : (
                        <span className="font-medium text-emerald-700">
                          {paymentStatusLabel[status]}
                          {status === "partial"
                            ? ` · ${formatMoney(prepaid)}`
                            : prepaid > 0
                              ? ` · ${formatMoney(prepaid)}`
                              : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatPaymentMethod(o.payment_method)}</td>
                    <td className="px-4 py-3">
                      {o.payment_date ? formatDate(o.payment_date) : "—"}
                    </td>
                    <td className="max-w-[280px] whitespace-pre-line px-4 py-3 text-xs text-muted-foreground">
                      {formatDishesPreview(o.dishes)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(o)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Удалить заказ?")) deleteMutation.mutate(o.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setMenuOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-lg" closeOnOutsideClick={false}>
          <DialogHeader>
            <DialogTitle>{editOrder ? "Редактировать заказ" : "Новый заказ"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Дата заказа</Label>
                <Input
                  type="date"
                  value={form.order_date}
                  onChange={(e) => set("order_date")(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Время</Label>
                <Input
                  type="time"
                  value={form.order_time}
                  onChange={(e) => set("order_time")(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Статус заказа</Label>
              <Select
                value={form.fulfillment_status}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    fulfillment_status: v as TakeawayFulfillmentStatus,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waiting">
                    {FULFILLMENT_LABEL.waiting}
                  </SelectItem>
                  <SelectItem value="picked_up">
                    {FULFILLMENT_LABEL.picked_up}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                После наступления времени заказа статус сам станет «Забрали»
              </p>
            </div>
            <div className="space-y-2">
              <Label>ФИО / имя</Label>
              <Input
                value={form.guest_name}
                onChange={(e) => set("guest_name")(e.target.value)}
                placeholder="Иванов Иван"
              />
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={form.phone}
                onChange={(e) => set("phone")(e.target.value)}
                placeholder="+7…"
              />
            </div>

            <div className="space-y-2">
              <Label>Блюда из меню на вынос</Label>
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
                    Открыть меню на вынос
                  </span>
                  {dishesSum > 0 && (
                    <span className="text-sm font-semibold tabular-nums text-emerald-700">
                      {formatMoney(dishesSum)}
                    </span>
                  )}
                </div>
                {form.dishes.trim() ? (
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
                    {dishesPreview}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Нажмите, чтобы выбрать блюда…
                  </p>
                )}
              </button>
              <p className="text-xs text-muted-foreground">
                Обслуживание не начисляется.
              </p>
            </div>

            {dishesSum <= 0 && (
              <div className="space-y-2">
                <Label>Общая сумма, ₸</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.payment_amount}
                  onChange={(e) => set("payment_amount")(e.target.value)}
                  placeholder="0"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Статус оплаты</Label>
              <Select
                value={form.payment_status}
                onValueChange={(v) => {
                  const payment_status = v as PaymentStatus;
                  setForm((p) => {
                    const eventDate = paymentDateForEvent(p.order_date, todayLocal());
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
                          ? paymentDateForEvent(p.order_date, todayLocal())
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
                      По умолчанию — дата заказа
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
        kind="takeaway"
        value={form.dishes}
        onClose={() => setMenuOpen(false)}
        onSave={(serialized) => {
          const sum = dishesTotal(parseDishes(serialized).items);
          setForm((p) => ({
            ...p,
            dishes: serialized,
            payment_amount: sum > 0 ? String(Math.round(sum)) : p.payment_amount,
          }));
        }}
      />
    </div>
  );
}
