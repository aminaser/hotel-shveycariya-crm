import { restaurantMenu, type MenuTab } from "@/lib/restaurant-menu";

export type { MenuTab };

/**
 * Default takeaway menu. Starts from the restaurant catalog so staff can
 * edit prices separately in «Настройки меню → На вынос».
 */
export const takeawayMenu: MenuTab[] = structuredClone(restaurantMenu);
