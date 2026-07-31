import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError, apiUrl } from "@/api/client";
import type { AppSettings } from "@/api/types";
import { type AuthUser, useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.role === "owner";
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [resetUserId, setResetUserId] = useState<number | "">("");
  const [resetPassword, setResetPassword] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<AppSettings>("/settings"),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<AuthUser[]>("/users"),
    enabled: isOwner,
  });

  const [local, setLocal] = useState<Partial<AppSettings>>({});

  const display = { ...settings, ...local };

  const saveSettings = useMutation({
    mutationFn: () =>
      apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          hotel_name: display.hotel_name,
          hotel_city: display.hotel_city,
          hotel_legal_name: display.hotel_legal_name,
          hotel_bin: display.hotel_bin,
          hotel_address: display.hotel_address,
          hotel_director: display.hotel_director,
          auto_lock_minutes: display.auto_lock_minutes,
          auto_backup_on_exit: display.auto_backup_on_exit,
        }),
      }),
    onSuccess: () => {
      toast.success("Настройки сохранены");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сохранить настройки");
    },
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch("/settings/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: passwords.current,
          new_password: passwords.next,
        }),
      }),
    onSuccess: () => {
      toast.success("Пароль изменён");
      setPasswords({ current: "", next: "", confirm: "" });
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сменить пароль");
    },
  });

  const resetOtherPassword = useMutation({
    mutationFn: () =>
      apiFetch(`/users/${resetUserId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ new_password: resetPassword }),
      }),
    onSuccess: () => {
      toast.success("Пароль пользователя обновлён");
      setResetUserId("");
      setResetPassword("");
    },
    onError: (e) => {
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось сбросить пароль");
    },
  });

  const backup = useMutation({
    mutationFn: () => apiFetch<{ path: string }>("/settings/backup", { method: "POST" }),
    onSuccess: (data) => {
      toast.success(`Бэкап создан: ${data.path}`);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Ошибка бэкапа"),
  });

  const restore = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const token = useAuthStore.getState().token;
      const response = await fetch(apiUrl("/settings/restore"), {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) throw new Error("restore failed");
    },
    onSuccess: () => toast.success("База восстановлена. Перезагрузите приложение."),
    onError: () => toast.error("Ошибка восстановления"),
  });

  if (!settings) return <div className="p-6">Загрузка...</div>;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Отель Швейцария · Текели</p>
      </div>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle>Отель</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input
                  value={display.hotel_name ?? ""}
                  onChange={(e) => setLocal({ ...local, hotel_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Город</Label>
                <Input
                  value={display.hotel_city ?? ""}
                  onChange={(e) => setLocal({ ...local, hotel_city: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Автоблокировка (мин)</Label>
                <Input
                  type="number"
                  value={display.auto_lock_minutes ?? 15}
                  onChange={(e) =>
                    setLocal({ ...local, auto_lock_minutes: parseInt(e.target.value, 10) })
                  }
                />
              </div>
              <div className="flex items-end gap-2">
                <input
                  id="auto-backup"
                  type="checkbox"
                  checked={display.auto_backup_on_exit ?? true}
                  onChange={(e) =>
                    setLocal({ ...local, auto_backup_on_exit: e.target.checked })
                  }
                />
                <Label htmlFor="auto-backup">Автобэкап при закрытии</Label>
              </div>
            </div>
            <Button onClick={() => saveSettings.mutate()}>Сохранить настройки</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Отель</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              {display.hotel_name ?? "—"} · {display.hotel_city ?? "—"}
            </p>
            <p>Автоблокировка: {display.auto_lock_minutes ?? 15} мин</p>
            <p>Изменение настроек доступно только владельцу.</p>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Юридические данные (для актов)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Полное наименование (ИП / ТОО)</Label>
              <Input
                value={display.hotel_legal_name ?? ""}
                onChange={(e) => setLocal({ ...local, hotel_legal_name: e.target.value })}
                placeholder="ИП Иванов / ТОО Швейцария"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>БИН исполнителя</Label>
                <Input
                  value={display.hotel_bin ?? ""}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      hotel_bin: e.target.value.replace(/\D/g, "").slice(0, 12),
                    })
                  }
                  placeholder="12 цифр"
                  maxLength={12}
                />
              </div>
              <div className="space-y-2">
                <Label>Руководитель (подпись в акте)</Label>
                <Input
                  value={display.hotel_director ?? ""}
                  onChange={(e) => setLocal({ ...local, hotel_director: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Юридический адрес</Label>
              <Input
                value={display.hotel_address ?? ""}
                onChange={(e) => setLocal({ ...local, hotel_address: e.target.value })}
                placeholder="г. Текели, ул. ..."
              />
            </div>
            <Button onClick={() => saveSettings.mutate()}>Сохранить юр. данные</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordInput
            placeholder="Текущий пароль"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <PasswordInput
            placeholder="Новый пароль"
            value={passwords.next}
            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
          />
          <PasswordInput
            placeholder="Подтверждение"
            value={passwords.confirm}
            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
          />
          <Button
            onClick={() => {
              if (passwords.next !== passwords.confirm) {
                toast.error("Пароли не совпадают");
                return;
              }
              changePassword.mutate();
            }}
          >
            Сменить пароль
          </Button>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Пользователи (владелец)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Сброс пароля администраторов. Администраторы не могут менять других пользователей.
            </p>
            <ul className="space-y-1 text-sm">
              {users.map((u) => (
                <li key={u.id}>
                  <span className="font-medium">{u.full_name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {u.username} · {u.role_label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <Label>Пользователь</Label>
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                value={resetUserId}
                onChange={(e) =>
                  setResetUserId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Выберите…</option>
                {users
                  .filter((u) => u.id !== currentUser?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.username})
                    </option>
                  ))}
              </select>
            </div>
            <PasswordInput
              placeholder="Новый пароль"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
            <Button
              disabled={
                !resetUserId || resetPassword.length < 6 || resetOtherPassword.isPending
              }
              onClick={() => resetOtherPassword.mutate()}
            >
              Установить пароль
            </Button>
          </CardContent>
        </Card>
      )}

      {window.electronAPI?.isElectron && (
        <Card>
          <CardHeader>
            <CardTitle>Обновления</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              При запуске приложение само проверяет GitHub Releases. Если вышла
              новая версия — скачает её в фоне и предложит перезапуск. Данные CRM
              при этом не трогаются.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={checkingUpdates}
              onClick={async () => {
                setCheckingUpdates(true);
                try {
                  const result = await window.electronAPI?.checkForUpdates();
                  if (!result?.ok) {
                    toast.error(
                      result?.reason === "updates_unavailable"
                        ? "Автообновление недоступно в этой сборке"
                        : "Не удалось проверить обновления",
                    );
                    return;
                  }
                  toast.success(
                    result.version
                      ? `Проверка выполнена (доступна ${result.version})`
                      : "Проверка обновлений запущена",
                  );
                } finally {
                  setCheckingUpdates(false);
                }
              }}
            >
              {checkingUpdates ? "Проверка…" : "Проверить обновления"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Резервное копирование</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            База данных: {settings.database_path}
          </p>
          {window.electronAPI?.isElectron && (
            <p className="text-xs text-muted-foreground">
              Данные приложения хранятся локально на этом компьютере.
            </p>
          )}
          {settings.last_backup_at && (
            <p className="text-sm">
              Последний бэкап: {new Date(settings.last_backup_at).toLocaleString("ru-RU")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
              Создать бэкап
            </Button>
            {isOwner && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".db";
                  input.onchange = () => {
                    const file = input.files?.[0];
                    if (file && confirm("Восстановить базу из файла?")) {
                      restore.mutate(file);
                    }
                  };
                  input.click();
                }}
              >
                Восстановить из .db
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
