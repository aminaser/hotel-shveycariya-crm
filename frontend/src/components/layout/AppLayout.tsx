import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarDays,
  ClipboardList,
  ClipboardPenLine,
  FileText,
  Flame,
  LogOut,
  PartyPopper,
  ScrollText,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { apiFetch } from "@/api/client";
import type { AppSettings } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/registry", label: "Журнал", icon: BookOpen },
  { to: "/rooms", label: "Номера", icon: BedDouble },
  { to: "/spa", label: "Сауна / баня", icon: Flame },
  { to: "/banquets", label: "Банкеты", icon: PartyPopper },
  { to: "/requests", label: "Заявки", icon: ClipboardList },
  { to: "/calendar", label: "Календарь", icon: CalendarDays },
  { to: "/acts", label: "Акты", icon: FileText },
  { to: "/clients", label: "Клиенты", icon: Users },
  { to: "/timesheet", label: "Табель", icon: ClipboardPenLine },
  { to: "/settings", label: "Настройки", icon: Settings },
  { to: "/activity", label: "Журнал действий", icon: ScrollText },
  { to: "/analytics", label: "Аналитика", icon: BarChart3 },
  { to: "/trash", label: "Корзина", icon: Trash2 },
];

export function AppLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  const visibleNavItems = navItems.filter(
    (item) => item.to !== "/analytics" || user?.role === "owner",
  );

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
            <NavLink
              key={to}
              to={to}
              end={to !== "/registry"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
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
