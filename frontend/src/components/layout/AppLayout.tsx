import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  ClipboardPenLine,
  FileText,
  Flame,
  LogOut,
  PartyPopper,
  RefreshCw,
  ScrollText,
  Settings,
  ShoppingBag,
  Trash2,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch } from "@/api/client";
import type { AppSettings } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useNewRecordNotifications } from "@/hooks/useNewRecordNotifications";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuthStore, canManageMenu, canViewAnalytics } from "@/stores/auth";
import { useBadgeStore } from "@/stores/badges";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/registry", label: "Журнал", icon: BookOpen },
  { to: "/bookings", label: "Бронь в отеле", icon: CalendarDays },
  { to: "/rooms", label: "Номера", icon: BedDouble },
  { to: "/spa", label: "Сауна / баня", icon: Flame },
  { to: "/banquets", label: "Банкеты", icon: PartyPopper },
  { to: "/takeaway", label: "На вынос", icon: ShoppingBag },
  { to: "/requests", label: "Заявки", icon: ClipboardList },
  { to: "/calendar", label: "Календарь", icon: CalendarRange },
  { to: "/acts", label: "Акты", icon: FileText },
  { to: "/clients", label: "Клиенты", icon: Users },
  { to: "/timesheet", label: "Табель", icon: ClipboardPenLine },
  { to: "/menu-settings", label: "Настройки меню", icon: UtensilsCrossed },
  { to: "/settings", label: "Настройки", icon: Settings },
  { to: "/activity", label: "Журнал действий", icon: ScrollText },
  { to: "/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/trash", label: "Корзина", icon: Trash2 },
];

function NavBadgeLink({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const badgeCount = useBadgeStore((s) => s.counts[to] ?? 0);
  const clearBadge = useBadgeStore((s) => s.clear);

  return (
    <NavLink
      to={to}
      end={to !== "/registry"}
      onClick={() => clearBadge(to)}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
          isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badgeCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white">
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}
    </NavLink>
  );
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [restarting, setRestarting] = useState(false);

  const queryClient = useQueryClient();
  useNewRecordNotifications();

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const channel = supabase
      .channel("crm-global-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "requests" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["bg-guest-requests"] });
        void queryClient.invalidateQueries({ queryKey: ["guest-requests"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "spa_bookings" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["bg-spa-bookings"] });
        void queryClient.invalidateQueries({ queryKey: ["spa-bookings"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_banquets" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["banquets"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_takeaway_orders" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["takeaway-orders"] });
      })
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [queryClient]);

  const visibleNavItems = navItems.filter((item) => {
    if (item.to === "/analytics") return canViewAnalytics(user);
    if (item.to === "/menu-settings") return canManageMenu(user);
    return true;
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<AppSettings>("/settings"),
  });

  const handleLogout = async () => {
    try {
      if (token) {
        await apiFetch("/auth/logout", { method: "POST" });
      }
    } catch {
      // ignore network errors on logout
    }
    logout();
    navigate("/login");
  };

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      if (window.electronAPI?.relaunchApp) {
        toast.success("Перезапуск приложения…");
        await window.electronAPI.relaunchApp();
        return;
      }
      window.location.reload();
    } catch (error) {
      console.error("relaunch-app failed:", error);
      setRestarting(false);
      toast.error(
        "Не удалось перезапустить. Закройте CRM полностью и откройте снова.",
      );
    }
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-primary text-white">
        <div className="border-b border-white/10 p-6">
          <div className="text-xs uppercase tracking-widest text-accent">Отель</div>
          <div className="text-xl font-bold">{settings?.hotel_name ?? "Швейцария"}</div>
          <div className="text-sm text-white/70">{settings?.hotel_city ?? "Текели"}</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavBadgeLink key={to} to={to} label={label} Icon={Icon} />
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-white hover:bg-white/10 hover:text-white"
            disabled={restarting}
            onClick={() => void handleRestart()}
          >
            <RefreshCw className={cn("h-4 w-4", restarting && "animate-spin")} />
            {restarting ? "Перезапуск…" : "Перезапустить"}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-white hover:bg-white/10 hover:text-white"
            onClick={() => void handleLogout()}
          >
            <LogOut className="h-4 w-4" />
            Выход
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-border bg-card px-6 py-3">
          <div className="text-sm text-muted-foreground">
            👤{" "}
            <span className="font-medium text-foreground">
              {user?.full_name ?? user?.username ?? "Пользователь"}
            </span>
            {user?.role_label ? (
              <span className="ml-2 text-xs">· {user.role_label}</span>
            ) : null}
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
