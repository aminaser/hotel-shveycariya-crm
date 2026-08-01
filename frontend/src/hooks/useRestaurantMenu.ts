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

/** Keep «Ас», «Поминки» and «Комплексный обед» first; use built-in catalog for those tabs. */
function ensurePinnedTabsFirst(tabs: MenuTab[]): MenuTab[] {
  const pinned = PINNED_TAB_IDS.map((id) =>
    defaultRestaurantMenu.find((t) => t.id === id),
  ).filter((t): t is MenuTab => Boolean(t));
  if (pinned.length === 0) return tabs;

  const pinnedIds = new Set(pinned.map((t) => t.id));
  const rest = tabs.filter((t) => !pinnedIds.has(t.id));
  return [...pinned.map((t) => structuredClone(t)), ...rest];
}

export function resolveRestaurantMenu(tabs: MenuTab[] | null | undefined): MenuTab[] {
  if (tabs && tabs.length > 0) return ensurePinnedTabsFirst(tabs);
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
