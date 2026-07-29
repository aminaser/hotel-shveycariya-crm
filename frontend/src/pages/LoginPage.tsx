import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      }),
    onSuccess: (data) => {
      setFormError(null);
      setAuth(data.access_token, data.user);
      navigate("/registry");
    },
    onError: (error) => {
      const message =
        error instanceof ApiError ? error.message : "Неверный логин или пароль.";
      setFormError(message);
      toast.error(message);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-xs uppercase tracking-widest text-accent">Отель</div>
          <CardTitle className="text-2xl">Швейцария</CardTitle>
          <p className="text-sm text-muted-foreground">Текели · Вход в CRM</p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="username">Логин</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
