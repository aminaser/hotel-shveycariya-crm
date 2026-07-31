import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Plus, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { TakeawayOrder } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { BanquetMenuSheet } from "@/components/BanquetMenuSheet";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
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
import { dishesTotal, formatDishesPreview, parseDishes } from "@/lib/banquet-dishes";
import { todayLocal } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
  type PaymentMethodPreset,
} from "@/lib/payment-method";
import { cn } from "@/lib/utils";

interface TakeawayForm {
  order_date: string;
  order_time: string;
  guest_name: string;
  phone: string;
  prepayment: string;
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
    prepayment: "",
    payment_method_preset: "cash",
    payment_method_custom: "",
    payment_date: todayLocal(),
    dishes: "",
  };
}

function toForm(o: TakeawayOrder): TakeawayForm {
  const { preset, customText } = splitPaymentMethod(o.payment_method);
  return {
    order_date: o.order_date,
    order_time: o.order_time ?? "",
    guest_name: o.guest_name,
    phone: o.phone ?? "",
    prepayment: o.prepayment && parseFloat(o.prepayment) > 0 ? o.prepayment : "",
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

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["takeaway-orders", authorId],
    queryFn: () => {
      const qs = authorId != null ? `?author_id=${authorId}` : "";
      return apiFetch<TakeawayOrder[]>(`/takeaway-orders${qs}`);
    },
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
    const prepayment = form.prepayment.trim() || "0";
    const paid = parseFloat(prepayment) > 0;
    return {
      order_date: form.order_date,
      order_time: form.order_time.trim() || null,
      guest_name: form.guest_name.trim(),
      phone: form.phone.trim() || null,
      prepayment,
      payment_method: paid
        ? resolvePaymentMethod(form.payment_method_preset, form.payment_method_custom)
        : null,
      payment_date: paid ? form.payment_date || todayLocal() : null,
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
    if (parseFloat(form.prepayment || "0") > 0) {
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
                <th className="px-4 py-3">Оплата</th>
                <th className="px-4 py-3">Способ</th>
                <th className="px-4 py-3">Дата оплаты</th>
                <th className="px-4 py-3">Блюда</th>
                <th className="w-24 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
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
                    {parseFloat(o.prepayment) > 0 ? (
                      <span className="font-medium text-emerald-700">
                        {formatMoney(o.prepayment)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">нет</span>
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
                        className="text-red-600 hover:text-red-700"
                        onClick={() => {
                          if (confirm(`Удалить заказ «${o.guest_name}»?`)) {
                            deleteMutation.mutate(o.id);
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
          closeOnOutsideClick
          onPointerDownOutside={(event) => {
            if (menuOpen) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (menuOpen) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (menuOpen) {
              event.preventDefault();
              setMenuOpen(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editOrder ? "Редактировать заказ" : "Новый заказ на вынос"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Дата</Label>
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
              <Label>ФИО / имя</Label>
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
                <Label>Сумма оплаты, ₸</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.prepayment}
                  onChange={(e) => set("prepayment")(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Дата оплаты</Label>
              <Input
                type="date"
                value={form.payment_date}
                onChange={(e) => set("payment_date")(e.target.value)}
                disabled={!form.prepayment || parseFloat(form.prepayment) <= 0}
              />
            </div>
            <PaymentMethodSelect
              preset={form.payment_method_preset}
              customText={form.payment_method_custom}
              onPresetChange={(value) => set("payment_method_preset")(value)}
              onCustomTextChange={(value) => set("payment_method_custom")(value)}
            />
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
        onSave={(serialized) => set("dishes")(serialized)}
      />
    </div>
  );
}
