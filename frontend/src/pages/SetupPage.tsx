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

export function SetupPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({
    username: "admin",
    password: "",
    confirm: "",
    hotel_name: "Швейцария",
    hotel_city: "Текели",
    room_from: "101",
    room_to: "110",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const room_numbers: string[] = [];
      const from = parseInt(form.room_from, 10);
      const to = parseInt(form.room_to, 10);
      for (let n = from; n <= to; n++) room_numbers.push(String(n));

      await apiFetch("/setup/init", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          hotel_name: form.hotel_name,
          hotel_city: form.hotel_city,
          room_numbers,
        }),
      });

      const login = await apiFetch<{ access_token: string; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          password: form.password,
        }),
      });
      return login;
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user);
      toast.success("Система настроена");
      navigate("/registry");
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) {
      toast.error("Пароль минимум 6 символов");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Пароли не совпадают");
      return;
    }
    const from = parseInt(form.room_from, 10);
    const to = parseInt(form.room_to, 10);
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
      toast.error("Укажите корректный диапазон номеров (от ≤ до)");
      return;
    }
    if (to - from > 200) {
      toast.error("Слишком много номеров (максимум 200)");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Настройка отеля «Швейцария»</CardTitle>
          <p className="text-sm text-muted-foreground">Первый запуск · Текели</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Логин</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Название отеля</Label>
                <Input
                  value={form.hotel_name}
                  onChange={(e) => setForm({ ...form, hotel_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Город</Label>
              <Input
                value={form.hotel_city}
                onChange={(e) => setForm({ ...form, hotel_city: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Пароль</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Подтверждение</Label>
                <Input
                  type="password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Номера с</Label>
                <Input
                  value={form.room_from}
                  onChange={(e) => setForm({ ...form, room_from: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Номера по</Label>
                <Input
                  value={form.room_to}
                  onChange={(e) => setForm({ ...form, room_to: e.target.value })}
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              Завершить настройку
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
