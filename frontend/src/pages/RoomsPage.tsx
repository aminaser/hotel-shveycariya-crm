import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { apiFetch, ApiError } from "@/api/client";
import type { Client, Room, RoomStatus } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, roomStatusLabel } from "@/lib/format";
import { hourLocal, todayLocal } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { canManagePrices, useAuthStore } from "@/stores/auth";

const STATUS_OPTIONS: RoomStatus[] = ["occupied", "free", "cleaning", "booked", "maintenance"];
const CHECK_IN_HOUR = 13;

const statusBadgeClass: Record<RoomStatus, string> = {
  occupied: "bg-red-100 text-red-800",
  free: "bg-emerald-100 text-emerald-800",
  cleaning: "bg-amber-100 text-amber-800",
  booked: "bg-blue-100 text-blue-800",
  maintenance: "bg-slate-200 text-slate-700",
};

const statusRowClass: Record<RoomStatus, string> = {
  occupied: "bg-red-50/40",
  free: "bg-emerald-50/40",
  cleaning: "bg-amber-50/40",
  booked: "bg-blue-50/40",
  maintenance: "bg-slate-50",
};

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function lastEditTime(room: Room): string {
  const candidates = [room.status_updated_at, room.stay_updated_at]
    .filter(Boolean)
    .map((v) => new Date(v as string).getTime())
    .filter((t) => !Number.isNaN(t));
  if (candidates.length === 0) return "—";
  return formatDateTime(new Date(Math.max(...candidates)).toISOString()) ?? "—";
}

function nowLocalInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roomSortKey(room: Room): number {
  const n = Number(room.number);
  return Number.isFinite(n) ? n : 999;
}

interface CheckInForm {
  guestName: string;
  phone: string;
  iin: string;
  checkInAt: string; // datetime-local
}

export function RoomsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEditPrices = canManagePrices(user);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState<Record<number, string>>({});
  const [typeDraft, setTypeDraft] = useState<Record<number, string>>({});
  const [form, setForm] = useState<CheckInForm>({
    guestName: "",
    phone: "",
    iin: "",
    checkInAt: nowLocalInputValue(),
  });

  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiFetch<Room[]>("/rooms"),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!pricesOpen) return;
    const nextPrices: Record<number, string> = {};
    const nextTypes: Record<number, string> = {};
    for (const room of rooms) {
      nextPrices[room.id] =
        room.price_per_night != null ? String(Math.round(Number(room.price_per_night))) : "";
      nextTypes[room.id] = room.room_type ?? "";
    }
    setPriceDraft(nextPrices);
    setTypeDraft(nextTypes);
  }, [pricesOpen, rooms]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["rooms"] });
    queryClient.invalidateQueries({ queryKey: ["stays"] });
    queryClient.invalidateQueries({ queryKey: ["stays-summary"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: RoomStatus }) =>
      apiFetch(`/rooms/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось обновить статус");
    },
  });

  const savePrices = useMutation({
    mutationFn: async () => {
      const list = [...rooms].sort((a, b) => roomSortKey(a) - roomSortKey(b));
      const updates = list.filter((room) => {
        const priceRaw = (priceDraft[room.id] ?? "").trim();
        const typeRaw = (typeDraft[room.id] ?? "").trim();
        const nextPrice = priceRaw === "" ? null : Math.max(0, Number(priceRaw) || 0);
        const prevPrice =
          room.price_per_night != null ? Math.round(Number(room.price_per_night)) : null;
        const prevType = (room.room_type ?? "").trim();
        return nextPrice !== prevPrice || typeRaw !== prevType;
      });
      for (const room of updates) {
        const priceRaw = (priceDraft[room.id] ?? "").trim();
        const typeRaw = (typeDraft[room.id] ?? "").trim();
        await apiFetch(`/rooms/${room.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            price_per_night: priceRaw === "" ? null : Math.max(0, Number(priceRaw) || 0),
            room_type: typeRaw || null,
          }),
        });
      }
      return updates.length;
    },
    onSuccess: (count) => {
      toast.success(count > 0 ? `Цены обновлены (${count})` : "Изменений нет");
      setPricesOpen(false);
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось сохранить цены");
    },
  });

  const checkIn = useMutation({
    mutationFn: async () => {
      if (!checkInRoom) throw new Error("Номер не выбран");
      const name = form.guestName.trim();
      if (!name) {
        toast.error("Укажите ФИО гостя");
        throw new Error("validation");
      }
      const checkInDate = form.checkInAt
        ? form.checkInAt.slice(0, 10)
        : todayLocal();
      const today = todayLocal();
      if (checkInDate > today) {
        toast.error("Дата заезда ещё не наступила");
        throw new Error("validation");
      }
      if (checkInDate === today && hourLocal() < CHECK_IN_HOUR) {
        toast.error(`Статус «в номере» можно поставить с ${CHECK_IN_HOUR}:00 в день заезда`);
        throw new Error("validation");
      }

      const client = await apiFetch<Client>("/clients", {
        method: "POST",
        body: JSON.stringify({
          full_name: name,
          phone: form.phone.trim() || null,
          iin: form.iin.trim() || null,
        }),
      });

      const stay = await apiFetch<{ id: number }>("/stays", {
        method: "POST",
        body: JSON.stringify({
          client_id: client.id,
          room_id: checkInRoom.id,
          record_date: checkInDate,
          stay_type: "booking",
          check_in: checkInDate,
          planned_check_out: null,
          payment_amount: checkInRoom.price_per_night
            ? String(Math.round(Number(checkInRoom.price_per_night)))
            : "0",
          payment_status: "unpaid",
          payment_method: null,
          notes: `Заселение: ${formatDateTime(form.checkInAt) ?? ""}`.trim() || null,
        }),
      });
      await apiFetch(`/rooms/${checkInRoom.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "occupied" }),
      });
      return stay;
    },
    onSuccess: () => {
      toast.success(`Гость заселён в №${checkInRoom?.number}`);
      setCheckInRoom(null);
      invalidate();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      if (e instanceof ApiError) toast.error(e.message);
      else toast.error("Не удалось заселить гостя");
    },
  });

  const onStatusChange = (room: Room, status: RoomStatus) => {
    if (status === room.status) return;
    if (status === "occupied") {
      const checkIn = room.check_in || todayLocal();
      const today = todayLocal();
      if (checkIn > today) {
        toast.error("Дата заезда ещё не наступила");
        return;
      }
      if (checkIn === today && hourLocal() < CHECK_IN_HOUR) {
        toast.error(`Статус «в номере» можно поставить с ${CHECK_IN_HOUR}:00 в день заезда`);
        return;
      }
    }
    // Walk-in check-in: no guest linked yet → open form.
    if (status === "occupied" && !room.current_guest) {
      setForm({ guestName: "", phone: "", iin: "", checkInAt: nowLocalInputValue() });
      setCheckInRoom(room);
      return;
    }
    updateStatus.mutate(
      { id: room.id, status },
      {
        onSuccess: () => {
          invalidate();
          if (status === "occupied" && room.status === "booked" && room.current_guest) {
            toast.success(`Гость в номере: ${room.current_guest} · №${room.number}`);
          } else {
            toast.success("Статус обновлён");
          }
        },
      },
    );
  };

  const ordered = [...rooms].sort((a, b) => roomSortKey(a) - roomSortKey(b));
  const freeCount = ordered.filter((r) => r.status === "free").length;
  const occupiedCount = ordered.filter((r) => r.status === "occupied").length;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Номера</h1>
          <p className="text-sm text-muted-foreground">
            Расценки за сутки · завтрак включён · выезд до 12:00 · заезд с 13:00
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditPrices && (
            <Button variant="outline" size="sm" onClick={() => setPricesOpen(true)}>
              <Pencil className="h-4 w-4" />
              Редактировать цены
            </Button>
          )}
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800">
            Свободно: {freeCount}
          </span>
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-800">
            Занято: {occupiedCount}
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Загрузка...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-20 px-4 py-3">Номер</th>
                <th className="w-36 px-4 py-3">Тип / цена</th>
                <th className="w-44 px-4 py-3">Статус</th>
                <th className="px-4 py-3">Информация</th>
                <th className="w-56 px-4 py-3">Изменить статус</th>
                <th className="w-44 px-4 py-3">Время ред. / заселения</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((room) => (
                <tr
                  key={room.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    statusRowClass[room.status],
                  )}
                >
                  <td className="px-4 py-3 text-xl font-bold">{room.number}</td>

                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium">
                      {room.price_per_night
                        ? `${Number(room.price_per_night).toLocaleString("ru-KZ")} ₸`
                        : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {room.room_type || "тип не указан"}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <Badge className={statusBadgeClass[room.status]}>
                      {roomStatusLabel[room.status]}
                    </Badge>
                  </td>

                  <td className="px-4 py-3">
                    {room.current_guest ? (
                      <div className="space-y-0.5 text-sm leading-snug">
                        <div className="font-medium">{room.current_guest}</div>
                        <div className="text-xs text-muted-foreground">
                          {room.guest_phone ?? "телефон не указан"}
                        </div>
                        <div className="text-xs">
                          {room.status === "booked" ? (
                            <>
                              Заселение в 13:00:{" "}
                              <span className="font-medium">
                                {room.check_in ? formatDate(room.check_in) : "—"}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                · до заселения
                              </span>
                            </>
                          ) : (
                            <>
                              В номере с{" "}
                              <span className="font-medium">
                                {room.check_in ? formatDate(room.check_in) : "—"}
                              </span>
                              {" · "}
                              Выезд:{" "}
                              <span className="font-medium">
                                {room.planned_check_out
                                  ? formatDate(room.planned_check_out)
                                  : "не указан"}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {roomStatusLabel[room.status]}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <Select
                      value={room.status}
                      onValueChange={(v) => onStatusChange(room, v as RoomStatus)}
                    >
                      <SelectTrigger className="h-9 bg-white/90">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {roomStatusLabel[value]}
                          </SelectItem>
                        ))}
                        {room.status === "maintenance" && (
                          <SelectItem value="maintenance">
                            {roomStatusLabel.maintenance}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </td>

                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {lastEditTime(room)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={checkInRoom !== null} onOpenChange={(open) => !open && setCheckInRoom(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Заселение · номер {checkInRoom?.number}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>ФИО гостя</Label>
              <Input
                value={form.guestName}
                onChange={(e) => setForm((p) => ({ ...p, guestName: e.target.value }))}
                placeholder="Иванов Иван"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+7…"
              />
            </div>
            <div className="space-y-2">
              <Label>ИИН (12 цифр)</Label>
              <Input
                value={form.iin}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    iin: e.target.value.replace(/\D/g, "").slice(0, 12),
                  }))
                }
                placeholder="000000000000"
                maxLength={12}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Дата и время заселения</Label>
              <Input
                type="datetime-local"
                value={form.checkInAt}
                onChange={(e) => setForm((p) => ({ ...p, checkInAt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInRoom(null)}>
              Отмена
            </Button>
            <Button onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>
              {checkIn.isPending ? "Заселение…" : "Заселить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pricesOpen} onOpenChange={setPricesOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Цены на номера</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Только для Жибек. Цена — за сутки, завтрак включён.
          </p>
          <div className="mt-2 space-y-3">
            {ordered.map((room) => (
              <div
                key={room.id}
                className="grid grid-cols-[48px_1fr_1fr] items-end gap-2 rounded-lg border border-border p-2.5"
              >
                <div className="pb-2 text-lg font-bold">№{room.number}</div>
                <div className="space-y-1">
                  <Label className="text-xs">Цена, ₸</Label>
                  <Input
                    type="number"
                    min={0}
                    value={priceDraft[room.id] ?? ""}
                    onChange={(e) =>
                      setPriceDraft((prev) => ({ ...prev, [room.id]: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Тип</Label>
                  <Input
                    value={typeDraft[room.id] ?? ""}
                    onChange={(e) =>
                      setTypeDraft((prev) => ({ ...prev, [room.id]: e.target.value }))
                    }
                    placeholder="одноместный…"
                  />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPricesOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => savePrices.mutate()} disabled={savePrices.isPending}>
              {savePrices.isPending ? "Сохранение…" : "Сохранить цены"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
