import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/api/client";
import { cloneMenu, type RestaurantMenuResponse } from "@/hooks/useRestaurantMenu";
import { takeawayMenu as defaultTakeawayMenu, type MenuTab } from "@/lib/takeaway-menu";

export type { RestaurantMenuResponse as TakeawayMenuResponse };

export function resolveTakeawayMenu(tabs: MenuTab[] | null | undefined): MenuTab[] {
  if (tabs && tabs.length > 0) return tabs;
  return defaultTakeawayMenu;
}

export function useTakeawayMenu(enabled = true) {
  const query = useQuery({
    queryKey: ["takeaway-menu"],
    queryFn: () => apiFetch<RestaurantMenuResponse>("/takeaway-menu"),
    enabled,
    staleTime: 30_000,
  });

  const menu = resolveTakeawayMenu(query.data?.tabs);
  return {
    ...query,
    menu,
    isCustom: Boolean(query.data?.is_custom && query.data.tabs?.length),
  };
}

export { cloneMenu, defaultTakeawayMenu };
