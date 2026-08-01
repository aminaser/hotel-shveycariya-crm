import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/api/client";
import {
  restaurantMenu as defaultRestaurantMenu,
  type MenuTab,
} from "@/lib/restaurant-menu";

export interface RestaurantMenuResponse {
  tabs: MenuTab[] | null;
  is_custom: boolean;
}

export function cloneMenu(tabs: MenuTab[]): MenuTab[] {
  return structuredClone(tabs);
}

const PINNED_TAB_IDS = ["as", "pominki", "complex-lunch"] as const;

/**
 * Keep «Ас», «Поминки» and «Комплексный обед» first.
 * Prefer saved custom prices for those tabs; fall back to the built-in catalog.
 */
function ensurePinnedTabsFirst(tabs: MenuTab[]): MenuTab[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const pinned = PINNED_TAB_IDS.map((id) => {
    const saved = byId.get(id);
    if (saved) return structuredClone(saved);
    const fallback = defaultRestaurantMenu.find((t) => t.id === id);
    return fallback ? structuredClone(fallback) : null;
  }).filter((t): t is MenuTab => Boolean(t));
  if (pinned.length === 0) return tabs;

  const pinnedIds = new Set(pinned.map((t) => t.id));
  const rest = tabs.filter((t) => !pinnedIds.has(t.id));
  return [...pinned, ...rest];
}

/**
 * Custom saved menus are a full snapshot. When the built-in catalog gets new
 * dishes, merge any missing ones into the matching subcategory so Жибек's
 * price edits stay and new positions still appear in banquet / takeaway sheets.
 */
export function mergeMissingDefaultItems(
  saved: MenuTab[],
  defaults: MenuTab[],
): MenuTab[] {
  const result = structuredClone(saved);
  for (const dTab of defaults) {
    let sTab = result.find((t) => t.id === dTab.id);
    if (!sTab) {
      result.push(structuredClone(dTab));
      continue;
    }
    for (const dSub of dTab.subcategories) {
      let sSub = sTab.subcategories.find((s) => s.id === dSub.id);
      if (!sSub) {
        sTab.subcategories.push(structuredClone(dSub));
        continue;
      }
      const existing = new Set(
        sSub.sections.flatMap((sec) =>
          sec.items.map((item) => item.name.trim().toLowerCase()),
        ),
      );
      for (const dSec of dSub.sections) {
        for (const item of dSec.items) {
          const key = item.name.trim().toLowerCase();
          if (!key || existing.has(key)) continue;
          if (sSub.sections.length === 0) {
            sSub.sections.push({ title: null, items: [] });
          }
          sSub.sections[sSub.sections.length - 1].items.push(structuredClone(item));
          existing.add(key);
        }
      }
    }
  }
  return result;
}

export function resolveRestaurantMenu(tabs: MenuTab[] | null | undefined): MenuTab[] {
  if (tabs && tabs.length > 0) {
    return ensurePinnedTabsFirst(
      mergeMissingDefaultItems(tabs, defaultRestaurantMenu),
    );
  }
  return defaultRestaurantMenu;
}

export function useRestaurantMenu(enabled = true) {
  const query = useQuery({
    queryKey: ["restaurant-menu"],
    queryFn: () => apiFetch<RestaurantMenuResponse>("/restaurant-menu"),
    enabled,
    staleTime: 30_000,
  });

  const menu = resolveRestaurantMenu(query.data?.tabs);
  return {
    ...query,
    menu,
    isCustom: Boolean(query.data?.is_custom && query.data.tabs?.length),
  };
}
