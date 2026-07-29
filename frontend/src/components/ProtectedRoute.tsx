import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiFetch } from "@/api/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { LockScreen } from "@/components/LockScreen";
import { type AuthUser, useAuthStore } from "@/stores/auth";
import { useIdleLock } from "@/hooks/useIdleLock";

export function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const locked = useIdleLock();

  const { data: me, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<AuthUser>("/auth/me"),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (me) setUser(me);
  }, [me, setUser]);

  useEffect(() => {
    if (isError) logout();
  }, [isError, logout]);

  useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<{ auto_lock_minutes: number }>("/settings"),
    enabled: !!token,
  });

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (locked) {
    return <LockScreen />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
