import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = "owner" | "admin";

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
  setAuth: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  touch: () => void;
  logout: () => void;
  isOwner: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      user: null,
      lastActivity: Date.now(),
      setAuth: (token, user) =>
        set({
          token,
          username: user.username,
          user,
          lastActivity: Date.now(),
        }),
      setUser: (user) => set({ user, username: user.username }),
      touch: () => set({ lastActivity: Date.now() }),
      logout: () => set({ token: null, username: null, user: null }),
      isOwner: () => get().user?.role === "owner",
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
