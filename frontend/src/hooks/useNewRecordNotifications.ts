import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiFetch } from "@/api/client";
import type { Banquet, Client, Stay } from "@/api/types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { GuestRequest, SpaBooking } from "@/lib/supabase";
import { useBadgeStore } from "@/stores/badges";

interface WatchedQuery {
  queryKey: string[];
  label: string;
  route: string;
  countFn: (data: unknown) => number;
}

const WATCHED: WatchedQuery[] = [
  {
    queryKey: ["stays"],
    label: "Журнал заселений",
    route: "/registry",
    countFn: (d) => (Array.isArray(d) ? d.length : 0),
  },
  {
    queryKey: ["bg-spa-bookings"],
    label: "Сауна / баня",
    route: "/spa",
    countFn: (d) => (Array.isArray(d) ? d.length : 0),
  },
  {
    queryKey: ["banquets"],
    label: "Банкеты",
    route: "/banquets",
    countFn: (d) => (Array.isArray(d) ? d.length : 0),
  },
  {
    queryKey: ["bg-guest-requests"],
    label: "Заявки",
    route: "/requests",
    countFn: (d) => (Array.isArray(d) ? d.length : 0),
  },
  {
    queryKey: ["clients"],
    label: "Клиенты",
    route: "/clients",
    countFn: (d) => (Array.isArray(d) ? d.length : 0),
  },
];

async function fetchRequestsBackground(): Promise<GuestRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GuestRequest[];
}

async function fetchSpaBackground(): Promise<SpaBooking[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("spa_bookings")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SpaBooking[];
}

/**
 * Background queries that keep data flowing even when the user is on
 * a different page, so the notification listener can detect new records.
 */
export function useBackgroundPolling() {
  useQuery({
    queryKey: ["bg-guest-requests"],
    queryFn: fetchRequestsBackground,
    enabled: isSupabaseConfigured,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ["bg-spa-bookings"],
    queryFn: fetchSpaBackground,
    enabled: isSupabaseConfigured,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ["stays"],
    queryFn: () => apiFetch<Stay[]>("/stays"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ["banquets"],
    queryFn: () => apiFetch<Banquet[]>("/banquets"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
}

export function useNewRecordNotifications(navigate: (path: string) => void) {
  const queryClient = useQueryClient();
  const countsRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  useBackgroundPolling();

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;

      for (const watched of WATCHED) {
        const queryKey = event.query.queryKey as string[];
        if (!watched.queryKey.every((k, i) => queryKey[i] === k)) continue;

        const cacheKey = watched.queryKey.join("/");
        const newCount = watched.countFn(event.action.data);
        const prevCount = countsRef.current.get(cacheKey);

        if (prevCount === undefined) {
          countsRef.current.set(cacheKey, newCount);
          break;
        }

        countsRef.current.set(cacheKey, newCount);

        if (!initializedRef.current) break;

        if (newCount > prevCount) {
          const diff = newCount - prevCount;
          useBadgeStore.getState().increment(watched.route, diff);
          toast.info(
            `Новая запись в «${watched.label}»!`,
            {
              description: diff === 1 ? "Добавлена 1 запись" : `Добавлено ${diff} записей`,
              action: {
                label: "Перейти",
                onClick: () => {
                  useBadgeStore.getState().clear(watched.route);
                  navigate(watched.route);
                },
              },
              duration: Infinity,
            },
          );
        }
        break;
      }
    });

    const timer = setTimeout(() => {
      initializedRef.current = true;
    }, 3000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [queryClient, navigate]);
}
