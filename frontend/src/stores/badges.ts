import { create } from "zustand";

interface BadgeState {
  counts: Record<string, number>;
  increment: (route: string, by?: number) => void;
  clear: (route: string) => void;
}

export const useBadgeStore = create<BadgeState>((set) => ({
  counts: {},
  increment: (route, by = 1) =>
    set((s) => ({ counts: { ...s.counts, [route]: (s.counts[route] ?? 0) + by } })),
  clear: (route) =>
    set((s) => {
      const next = { ...s.counts };
      delete next[route];
      return { counts: next };
    }),
}));
