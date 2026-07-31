import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { ClientDetail } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatMoney, paymentStatusLabel, stayTypeLabel, copyToClipboard } from "@/lib/format";
import { formatPaymentMethod } from "@/lib/payment-method";
import { cn } from "@/lib/utils";

interface ClientProfileSheetProps {
  clientId: number | null;
  onClose: () => void;
}

export function ClientProfileSheet({ clientId, onClose }: ClientProfileSheetProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    client_type: "individual" as "individual" | "organization",
    iin: "",
    bin: "",
    age: "",
    date_of_birth: "",
    document_number: "",
    notes: "",
  });

  const { data: client, isLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => apiFetch<ClientDetail>(`/clients/${clientId}`),
    enabled: clientId !== null,
  });

  useEffect(() => {
    if (client) {
      setForm({
        full_name: client.full_name,
        phone: client.phone ?? "",
        client_type: client.client_type ?? "individual",
        iin: client.iin ?? "",
        bin: client.bin ?? "",
        age: client.age?.toString() ?? "",
        date_of_birth: client.date_of_birth ?? "",
        document_number: client.document_number ?? "",
        notes: client.notes ?? "",
      });
    }
  }, [client]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!clientId) throw new Error("Клиент не выбран");
      const name = form.full_name.trim();
      if (name.length < 2) {
        throw new ApiError("Укажите ФИО (минимум 2 символа)", 400);
      }
      return apiFetch(`/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: name,
          phone: form.phone.trim() || null,
          client_type: form.client_type,
          iin: form.client_type === "individual" ? form.iin || null : null,
          bin: form.client_type === "organization" ? form.bin || null : null,
          age: form.age ? parseInt(form.age, 10) : null,
          date_of_birth: form.date_of_birth || null,
          document_number: form.document_number.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Данные клиента сохранены");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["stays"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось сохранить");
    },
  });

  if (clientId === null) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">Редактирование клиента</h2>
            {client && (
              <p className="text-xs text-muted-foreground">
                Визитов: {client.stays.length}
                {client.stays.length >= 3 ? " · Постоянный гость" : ""}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <p className="text-muted-foreground">Загрузка...</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="client-full-name">ФИО</Label>
                <Input
                  id="client-full-name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-phone">Телефон</Label>
                <div className="flex gap-2">
                  <Input
                    id="client-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+7 (7XX) XXX-XX-XX"
                  />
                  {form.phone && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 px-2"
                      onClick={async () => {
                        const ok = await copyToClipboard(form.phone);
                        if (ok) toast.success("Телефон скопирован");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Тип</Label>
                <Select
                  value={form.client_type}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      client_type: v as "individual" | "organization",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Физическое лицо</SelectItem>
                    <SelectItem value="organization">Организация</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.client_type === "individual" ? (
                <div className="space-y-2">
                  <Label htmlFor="client-iin">ИИН (12 цифр)</Label>
                  <Input
                    id="client-iin"
                    value={form.iin}
                    onChange={(e) =>
                      setForm({ ...form, iin: e.target.value.replace(/\D/g, "").slice(0, 12) })
                    }
                    maxLength={12}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="client-bin">БИН (12 цифр)</Label>
                  <Input
                    id="client-bin"
                    value={form.bin}
                    onChange={(e) =>
                      setForm({ ...form, bin: e.target.value.replace(/\D/g, "").slice(0, 12) })
                    }
                    maxLength={12}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="client-age">Возраст</Label>
                  <Input
                    id="client-age"
                    type="number"
                    min={0}
                    max={150}
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-dob">Дата рождения</Label>
                  <Input
                    id="client-dob"
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-document">Документ</Label>
                <Input
                  id="client-document"
                  value={form.document_number}
                  onChange={(e) =>
                    setForm({ ...form, document_number: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-notes">Заметки</Label>
                <textarea
                  id="client-notes"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !form.full_name.trim()}
              >
                {saveMutation.isPending ? "Сохранение..." : "Сохранить изменения"}
              </Button>

              {client && client.stays.length > 0 && (
                <div className="pt-4">
                  <h3 className="mb-2 font-medium">История проживаний</h3>
                  <div className="space-y-2">
                    {client.stays.map((stay) => (
                      <div
                        key={stay.id}
                        className="rounded-lg border border-border p-3 text-sm"
                      >
                        <div>{formatDate(stay.record_date)} · №{stay.room_number}</div>
                        <div className="text-muted-foreground">
                          {stayTypeLabel[stay.stay_type]} ·{" "}
                          {paymentStatusLabel[stay.payment_status]} ·{" "}
                          {formatMoney(stay.payment_amount)} ·{" "}
                          {formatPaymentMethod(stay.payment_method)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
