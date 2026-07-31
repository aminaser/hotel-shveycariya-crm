import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "owner" | "admin";

/** Only Жибек (login: zhibek) can open analytics and menu settings. */
export const ANALYTICS_OWNER_USERNAME = "zhibek";

export function canViewAnalytics(user: { username?: string | null } | null | undefined): boolean {
  return (user?.username ?? "").trim().toLowerCase() === ANALYTICS_OWNER_USERNAME;
}

/** Menu settings are only for Жибек. */
export function canManageMenu(user: { username?: string | null } | null | undefined): boolean {
  return canViewAnalytics(user);
}

/** Room / spa base prices — only Жибек. */
export function canManagePrices(user: { username?: string | null } | null | undefined): boolean {
  return canViewAnalytics(user);
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  role_label: string;
  created_at: string;
}

interface AuthState {
  token: string | null;
  username: string | null;
  user: AuthUser | null;
  lastActivity: number;
  locked: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  touch: () => void;
  lock: () => void;
  unlock: () => void;
  logout: () => void;
  isOwner: () => boolean;
  canViewAnalytics: () => boolean;
  canManageMenu: () => boolean;
  canManagePrices: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      user: null,
      lastActivity: Date.now(),
      locked: false,
      setAuth: (token, user) =>
        set({
          token,
          username: user.username,
          user,
          lastActivity: Date.now(),
          locked: false,
        }),
      setUser: (user) => set({ user, username: user.username }),
      touch: () => set({ lastActivity: Date.now() }),
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false, lastActivity: Date.now() }),
      logout: () => set({ token: null, username: null, user: null, locked: false }),
      isOwner: () => get().user?.role === "owner",
      canViewAnalytics: () => canViewAnalytics(get().user),
      canManageMenu: () => canManageMenu(get().user),
      canManagePrices: () => canManagePrices(get().user),
    }),
    {
      name: "hotel-crm-auth",
      partialize: (state) => ({
        token: state.token,
        username: state.username,
        user: state.user,
      }),
    },
  ),
);
