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

export function resolveRestaurantMenu(tabs: MenuTab[] | null | undefined): MenuTab[] {
  if (tabs && tabs.length > 0) return tabs;
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
