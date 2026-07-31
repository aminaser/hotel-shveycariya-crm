import { Minus, Plus, Search, Trash2, UtensilsCrossed, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRestaurantMenu } from "@/hooks/useRestaurantMenu";
import { useTakeawayMenu } from "@/hooks/useTakeawayMenu";
import {
  BANQUET_SERVICE_CHARGE_PERCENT,
  dishDisplayName,
  dishLineTotal,
  dishesTotalWithService,
  parseDishes,
  serializeDishes,
  type OrderedDish,
} from "@/lib/banquet-dishes";
import { formatMoney } from "@/lib/format";
import {
  flattenMenu,
  searchCatalogItems,
  type MenuCatalogItem,
  type MenuTab,
} from "@/lib/restaurant-menu";
import { cn } from "@/lib/utils";

export type OrderMenuKind = "banquet" | "takeaway";

interface BanquetMenuSheetProps {
  open: boolean;
  value: string;
  onClose: () => void;
  onSave: (serialized: string) => void;
  /** Banquet uses restaurant menu + 10% service; takeaway uses takeaway menu, no service. */
  kind?: OrderMenuKind;
}

function QtyInput({
  value,
  onChange,
  min = 1,
  className,
  "aria-label": ariaLabel = "Количество",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!raw || Number.isNaN(n) || n < min) {
      onChange(min);
      setText(String(min));
      return;
    }
    onChange(n);
    setText(String(n));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        setText(raw);
        if (raw === "") return;
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n >= min) onChange(n);
      }}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(text);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onFocus={(e) => e.target.select()}
      className={cn(
        "h-8 w-14 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums outline-none",
        className,
      )}
    />
  );
}

export function BanquetMenuSheet({
  open,
  value,
  onClose,
  onSave,
  kind = "banquet",
}: BanquetMenuSheetProps) {
  const isTakeaway = kind === "takeaway";
  const restaurant = useRestaurantMenu(open && !isTakeaway);
  const takeaway = useTakeawayMenu(open && isTakeaway);
  const menu = isTakeaway ? takeaway.menu : restaurant.menu;
  const isLoading = isTakeaway ? takeaway.isLoading : restaurant.isLoading;
  const applyService = !isTakeaway;

  const [tabId, setTabId] = useState(menu[0]?.id ?? "custom");
  const [subId, setSubId] = useState(menu[0]?.subcategories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<OrderedDish[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    const parsed = parseDishes(value);
    setOrder(parsed.items);
    setNote(parsed.note);
    setQuery("");
    setDraftQty({});
    const firstTab = menu.find((t: MenuTab) => t.id === "custom") ?? menu[0];
    if (firstTab) {
      setTabId(firstTab.id);
      setSubId(firstTab.subcategories[0]?.id ?? "");
    }
  }, [open, value, menu]);

  const catalog = useMemo(() => flattenMenu(menu), [menu]);

  const activeTab = menu.find((t) => t.id === tabId) ?? menu[0];
  const activeSub =
    activeTab?.subcategories.find((s) => s.id === subId) ?? activeTab?.subcategories[0];

  useEffect(() => {
    if (!activeTab) return;
    if (!activeTab.subcategories.some((s) => s.id === subId)) {
      setSubId(activeTab.subcategories[0]?.id ?? "");
    }
  }, [activeTab, subId]);

  const filteredCatalog = useMemo(
    () => searchCatalogItems(query, catalog),
    [query, catalog],
  );

  const visibleItems = useMemo(() => {
    if (query.trim()) return filteredCatalog;
    return catalog.filter(
      (item) => item.tabId === tabId && item.subcategoryId === (activeSub?.id ?? subId),
    );
  }, [query, filteredCatalog, tabId, activeSub?.id, subId, catalog]);

  const groupedVisible = useMemo(() => {
    const groups = new Map<string, MenuCatalogItem[]>();
    for (const item of visibleItems) {
      const label = query.trim()
        ? `${item.tabTitle} · ${item.subcategoryTitle}${item.sectionTitle ? ` · ${item.sectionTitle}` : ""}`
        : item.sectionTitle ?? activeSub?.title ?? "Блюда";
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }
    return [...groups.entries()];
  }, [visibleItems, query, activeSub?.title]);

  const { subtotal, service, total } = dishesTotalWithService(order);
  const displayTotal = applyService ? total : subtotal;
  const orderCount = order.reduce((sum, item) => sum + item.quantity, 0);

  const getDraftQty = (key: string) => draftQty[key] ?? 1;

  const setItemQty = (key: string, next: number) => {
    setDraftQty((prev) => ({ ...prev, [key]: Math.max(1, next) }));
  };

  const addToOrder = (item: MenuCatalogItem) => {
    const qty = getDraftQty(item.key);
    setOrder((prev) => {
      const existing = prev.find((row) => row.key === item.key);
      if (existing) {
        return prev.map((row) =>
          row.key === item.key ? { ...row, quantity: row.quantity + qty } : row,
        );
      }
      return [
        ...prev,
        {
          key: item.key,
          name: item.name,
          price: item.price,
          quantity: qty,
          ...(item.size ? { size: item.size } : {}),
        },
      ];
    });
    setDraftQty((prev) => ({ ...prev, [item.key]: 1 }));
  };

  const updateOrderQty = (key: string, quantity: number) => {
    if (quantity <= 0) {
      setOrder((prev) => prev.filter((row) => row.key !== key));
      return;
    }
    setOrder((prev) =>
      prev.map((row) => (row.key === key ? { ...row, quantity } : row)),
    );
  };

  const handleSave = () => {
    onSave(serializeDishes(order, note));
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div data-banquet-menu-sheet="" className="pointer-events-auto">
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[80] flex h-full w-full max-w-3xl flex-col border-l border-border bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <UtensilsCrossed className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {isTakeaway ? "Меню на вынос" : "Меню ресторана"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {isTakeaway
                    ? "Выберите блюда для заказа на вынос (без обслуживания)"
                    : `Выберите блюда для банкета (+${BANQUET_SERVICE_CHARGE_PERCENT}% обслуживание)`}
                </p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Поиск блюда…"
                  className="pl-9"
                />
              </div>

              {!query.trim() && (
                <>
                  <nav className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {menu.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setTabId(tab.id);
                          setSubId(tab.subcategories[0]?.id ?? "");
                        }}
                        className={cn(
                          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          tab.id === tabId
                            ? "bg-foreground text-background"
                            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {tab.title}
                      </button>
                    ))}
                  </nav>
                  {(activeTab?.subcategories.length ?? 0) > 1 && (
                    <nav className="flex gap-1.5 overflow-x-auto">
                      {activeTab?.subcategories.map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => setSubId(sub.id)}
                          className={cn(
                            "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                            sub.id === activeSub?.id
                              ? "border-emerald-600/30 bg-emerald-50 text-emerald-800"
                              : "border-border bg-background text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {sub.title}
                        </button>
                      ))}
                    </nav>
                  )}
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {isLoading ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  Загрузка меню…
                </div>
              ) : groupedVisible.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Search className="h-5 w-5 opacity-50" />
                  Ничего не найдено
                </div>
              ) : (
                <div className="space-y-5">
                  {groupedVisible.map(([groupTitle, items]) => (
                    <section key={groupTitle}>
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {groupTitle}
                      </h3>
                      <ul className="space-y-2">
                        {items.map((item) => {
                          const inOrder = order.find((row) => row.key === item.key);
                          return (
                            <li
                              key={item.key}
                              className="rounded-xl border border-border bg-background p-3 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium leading-snug">{item.displayName}</p>
                                  {item.description && (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                      {item.description}
                                    </p>
                                  )}
                                  <p className="mt-2 text-sm font-semibold text-emerald-700">
                                    {formatMoney(item.price)}
                                  </p>
                                </div>
                                {inOrder && (
                                  <Badge variant="success">×{inOrder.quantity}</Badge>
                                )}
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-2">
                                <div className="inline-flex items-center rounded-lg border border-border bg-muted/40">
                                  <button
                                    type="button"
                                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      setItemQty(item.key, getDraftQty(item.key) - 1)
                                    }
                                    aria-label="Уменьшить"
                                  >
                                    <Minus className="h-3.5 w-3.5" />
                                  </button>
                                  <QtyInput
                                    value={getDraftQty(item.key)}
                                    onChange={(n) => setItemQty(item.key, n)}
                                  />
                                  <button
                                    type="button"
                                    className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      setItemQty(item.key, getDraftQty(item.key) + 1)
                                    }
                                    aria-label="Увеличить"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <Button size="sm" onClick={() => addToOrder(item)}>
                                  <Plus className="h-3.5 w-3.5" />
                                  В заказ
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex h-[42%] min-h-[220px] w-full flex-col bg-muted/20 lg:h-auto lg:w-[300px] lg:shrink-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Список заказных блюд</p>
                <p className="text-xs text-muted-foreground">
                  {orderCount > 0 ? `${orderCount} поз.` : "Пока пусто"}
                </p>
              </div>
              {order.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => setOrder([])}
                >
                  Очистить
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {order.length === 0 ? (
                <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
                  <UtensilsCrossed className="h-5 w-5 opacity-40" />
                  Добавьте блюда из меню слева
                </div>
              ) : (
                <ul className="space-y-2">
                  {order.map((item) => (
                    <li
                      key={item.key}
                      className="rounded-xl border border-border bg-background p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug">
                            {dishDisplayName(item)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatMoney(item.price)} × {item.quantity}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                          onClick={() => updateOrderQty(item.key, 0)}
                          aria-label="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-lg border border-border">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center"
                            onClick={() => updateOrderQty(item.key, item.quantity - 1)}
                            aria-label="Уменьшить"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <QtyInput
                            value={item.quantity}
                            onChange={(n) => updateOrderQty(item.key, n)}
                            className="h-7 w-12 text-xs"
                          />
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center"
                            onClick={() => updateOrderQty(item.key, item.quantity + 1)}
                            aria-label="Увеличить"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatMoney(dishLineTotal(item))}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Заметка (необязательно)
                </label>
                <textarea
                  className="min-h-[64px] w-full rounded-lg border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Особые пожелания к заказу…"
                />
              </div>
            </div>

            <div className="border-t border-border bg-background px-4 py-3">
              <div className="mb-3 space-y-1">
                {applyService && service > 0 ? (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Блюда</span>
                      <span className="tabular-nums">{formatMoney(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Обслуживание {BANQUET_SERVICE_CHARGE_PERCENT}%</span>
                      <span className="tabular-nums">{formatMoney(service)}</span>
                    </div>
                  </>
                ) : null}
                <div className="flex items-end justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Итого</span>
                  <span className="text-xl font-bold tabular-nums tracking-tight text-emerald-700">
                    {formatMoney(displayTotal)}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Отмена
                </Button>
                <Button className="flex-1" onClick={handleSave}>
                  Применить
                </Button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
