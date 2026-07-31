import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cloneMenu,
  useRestaurantMenu,
  type RestaurantMenuResponse,
} from "@/hooks/useRestaurantMenu";
import { formatMoney } from "@/lib/format";
import { restaurantMenu as defaultMenu, type MenuItem, type MenuTab } from "@/lib/restaurant-menu";
import { cn } from "@/lib/utils";

export function MenuSettingsPage() {
  const queryClient = useQueryClient();
  const { menu, isCustom, isLoading } = useRestaurantMenu();
  const [draft, setDraft] = useState<MenuTab[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tabId, setTabId] = useState("");
  const [subId, setSubId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDescription, setNewDescription] = useState("");

  useEffect(() => {
    if (dirty) return;
    const next = cloneMenu(menu);
    setDraft(next);
    const preferred = next.find((t) => t.id === "custom") ?? next[0];
    setTabId((prev) => (next.some((t) => t.id === prev) ? prev : preferred?.id ?? ""));
    setSubId((prev) => {
      const tab = next.find((t) => t.id === (next.some((x) => x.id === tabId) ? tabId : preferred?.id));
      if (tab?.subcategories.some((s) => s.id === prev)) return prev;
      return tab?.subcategories[0]?.id ?? preferred?.subcategories[0]?.id ?? "";
    });
    // Only re-seed draft when server menu changes and local edits are clean.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabId intentionally omitted
  }, [menu, dirty]);

  const activeTab = draft.find((t) => t.id === tabId) ?? draft[0];
  const activeSub =
    activeTab?.subcategories.find((s) => s.id === subId) ?? activeTab?.subcategories[0];

  useEffect(() => {
    if (!activeTab) return;
    if (!activeTab.subcategories.some((s) => s.id === subId)) {
      setSubId(activeTab.subcategories[0]?.id ?? "");
    }
  }, [activeTab, subId]);

  const itemCount = useMemo(
    () =>
      draft.reduce(
        (sum, tab) =>
          sum +
          tab.subcategories.reduce(
            (subSum, sub) =>
              subSum + sub.sections.reduce((secSum, section) => secSum + section.items.length, 0),
            0,
          ),
        0,
      ),
    [draft],
  );

  const updateDraft = (updater: (prev: MenuTab[]) => MenuTab[]) => {
    setDraft((prev) => updater(prev));
    setDirty(true);
  };

  const updateItem = (
    sectionIndex: number,
    itemIndex: number,
    patch: Partial<MenuItem>,
  ) => {
    if (!activeTab || !activeSub) return;
    updateDraft((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab;
        return {
          ...tab,
          subcategories: tab.subcategories.map((sub) => {
            if (sub.id !== activeSub.id) return sub;
            return {
              ...sub,
              sections: sub.sections.map((section, sIdx) => {
                if (sIdx !== sectionIndex) return section;
                return {
                  ...section,
                  items: section.items.map((item, iIdx) =>
                    iIdx === itemIndex ? { ...item, ...patch } : item,
                  ),
                };
              }),
            };
          }),
        };
      }),
    );
  };

  const updateSizePrice = (
    sectionIndex: number,
    itemIndex: number,
    sizeIndex: number,
    price: number,
  ) => {
    if (!activeTab || !activeSub) return;
    updateDraft((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab;
        return {
          ...tab,
          subcategories: tab.subcategories.map((sub) => {
            if (sub.id !== activeSub.id) return sub;
            return {
              ...sub,
              sections: sub.sections.map((section, sIdx) => {
                if (sIdx !== sectionIndex) return section;
                return {
                  ...section,
                  items: section.items.map((item, iIdx) => {
                    if (iIdx !== itemIndex || !item.sizes) return item;
                    return {
                      ...item,
                      sizes: item.sizes.map((size, zIdx) =>
                        zIdx === sizeIndex ? { ...size, price } : size,
                      ),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
    );
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    if (!activeTab || !activeSub) return;
    updateDraft((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab;
        return {
          ...tab,
          subcategories: tab.subcategories.map((sub) => {
            if (sub.id !== activeSub.id) return sub;
            return {
              ...sub,
              sections: sub.sections.map((section, sIdx) => {
                if (sIdx !== sectionIndex) return section;
                return {
                  ...section,
                  items: section.items.filter((_, iIdx) => iIdx !== itemIndex),
                };
              }),
            };
          }),
        };
      }),
    );
  };

  const addItem = () => {
    if (!activeTab || !activeSub) return;
    const name = newName.trim();
    const price = parseFloat(newPrice.replace(",", "."));
    if (name.length < 2) {
      toast.error("Укажите название блюда");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Укажите корректную цену");
      return;
    }
    const item: MenuItem = {
      name,
      price,
      ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
    };
    updateDraft((prev) =>
      prev.map((tab) => {
        if (tab.id !== activeTab.id) return tab;
        return {
          ...tab,
          subcategories: tab.subcategories.map((sub) => {
            if (sub.id !== activeSub.id) return sub;
            const sections =
              sub.sections.length > 0
                ? sub.sections.map((section, idx) =>
                    idx === sub.sections.length - 1
                      ? { ...section, items: [...section.items, item] }
                      : section,
                  )
                : [{ title: null, items: [item] }];
            return { ...sub, sections };
          }),
        };
      }),
    );
    setNewName("");
    setNewPrice("");
    setNewDescription("");
    toast.success("Позиция добавлена — не забудьте сохранить");
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<RestaurantMenuResponse>("/restaurant-menu", {
        method: "PUT",
        body: JSON.stringify({ tabs: draft }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["restaurant-menu"], data);
      setDirty(false);
      toast.success("Меню сохранено — цены обновлены для банкетов");
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сохранить меню");
    },
  });

  const resetToDefault = () => {
    if (!confirm("Сбросить меню к стандартному? Несохранённые правки пропадут.")) return;
    setDraft(cloneMenu(defaultMenu));
    setDirty(true);
    const first = defaultMenu.find((t) => t.id === "custom") ?? defaultMenu[0];
    setTabId(first?.id ?? "");
    setSubId(first?.subcategories[0]?.id ?? "");
  };

  if (isLoading && draft.length === 0) {
    return <p className="p-6 text-muted-foreground">Загрузка меню…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-emerald-700">
            <UtensilsCrossed className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Только для Жибек</span>
          </div>
          <h1 className="text-2xl font-bold">Настройки меню</h1>
          <p className="text-sm text-muted-foreground">
            Редактируйте цены и добавляйте позиции. После сохранения меню обновится в банкетах.
            {isCustom ? " · Сейчас используется сохранённое меню" : " · Стандартное меню"}
            {` · ${itemCount} позиций`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={resetToDefault}>
            Сбросить к стандартному
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending}
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-3">
          <nav className="flex gap-1.5 overflow-x-auto pb-0.5">
            {draft.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTabId(tab.id);
                  setSubId(tab.subcategories[0]?.id ?? "");
                }}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  tab.id === activeTab?.id
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
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          {activeSub?.sections.map((section, sectionIndex) => (
            <section key={`${activeSub.id}-${sectionIndex}-${section.title ?? "main"}`}>
              {section.title && (
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h3>
              )}
              <ul className="space-y-3">
                {section.items.map((item, itemIndex) => (
                  <li
                    key={`${item.name}-${itemIndex}`}
                    className="rounded-xl border border-border bg-background p-3 shadow-sm"
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <Input
                          value={item.name}
                          onChange={(e) =>
                            updateItem(sectionIndex, itemIndex, { name: e.target.value })
                          }
                          placeholder="Название"
                        />
                        <Input
                          value={item.description ?? ""}
                          onChange={(e) =>
                            updateItem(sectionIndex, itemIndex, {
                              description: e.target.value || undefined,
                            })
                          }
                          placeholder="Состав / описание (необязательно)"
                        />
                        {item.sizes?.length ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {item.sizes.map((size, sizeIndex) => (
                              <div
                                key={`${size.size}-${sizeIndex}`}
                                className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                              >
                                <span className="min-w-16 text-xs text-muted-foreground">
                                  {size.size}
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  value={size.price}
                                  onChange={(e) =>
                                    updateSizePrice(
                                      sectionIndex,
                                      itemIndex,
                                      sizeIndex,
                                      Math.max(0, parseFloat(e.target.value) || 0),
                                    )
                                  }
                                  className="h-8"
                                />
                                <span className="text-xs text-muted-foreground">₸</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex max-w-[220px] items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              value={item.price ?? 0}
                              onChange={(e) =>
                                updateItem(sectionIndex, itemIndex, {
                                  price: Math.max(0, parseFloat(e.target.value) || 0),
                                })
                              }
                            />
                            <span className="text-sm text-muted-foreground">₸</span>
                            <span className="text-sm font-medium text-emerald-700">
                              {formatMoney(item.price ?? 0)}
                            </span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => removeItem(sectionIndex, itemIndex)}
                        aria-label="Удалить позицию"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="rounded-xl border border-dashed border-emerald-300/70 bg-emerald-50/40 p-4">
            <h3 className="mb-3 text-sm font-semibold text-emerald-900">
              Добавить позицию в «{activeSub?.title ?? "категорию"}»
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Название</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Например: Манты (1 шт)"
                />
              </div>
              <div className="space-y-2">
                <Label>Цена, ₸</Label>
                <Input
                  type="number"
                  min={0}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="350"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Описание</Label>
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Необязательно"
                />
              </div>
            </div>
            <Button className="mt-3" onClick={addItem}>
              <Plus className="h-4 w-4" />
              Добавить в список
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              После добавления нажмите «Сохранить» сверху, чтобы меню обновилось в банкетах.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
