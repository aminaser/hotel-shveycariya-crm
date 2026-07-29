import { useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthUser, useAuthStore } from "@/stores/auth";

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

export function LockScreen() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);
  const username = useAuthStore((s) => s.username);
  const fullName = useAuthStore((s) => s.user?.full_name);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username ?? "", password }),
      });
      setAuth(data.access_token, data.user);
      toast.success("Экран разблокирован");
    } catch (error) {
      if (error instanceof ApiError) toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Сессия заблокирована</CardTitle>
          <p className="text-sm text-muted-foreground">
            {fullName ?? username}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={unlock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lock-password">Пароль</Label>
              <Input
                id="lock-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading} className="flex-1">
                Разблокировать
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
                  logout();
                }}
              >
                Выйти
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
