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
        document_number: client.document_number ?? "",
        notes: client.notes ?? "",
      });
    }
  }, [client]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/clients/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: form.full_name,
          phone: form.phone || null,
          client_type: form.client_type,
          iin: form.client_type === "individual" ? form.iin || null : null,
          bin: form.client_type === "organization" ? form.bin || null : null,
          age: form.age ? parseInt(form.age, 10) : null,
          document_number: form.document_number || null,
          notes: form.notes || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Клиент сохранён");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["stays"] });
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
            <h2 className="text-lg font-semibold">Карточка клиента</h2>
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
                <Label>ФИО</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Телефон</Label>
                <div className="flex gap-2">
                  <Input
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
                  <Label>ИИН (12 цифр)</Label>
                  <Input
                    value={form.iin}
                    onChange={(e) =>
                      setForm({ ...form, iin: e.target.value.replace(/\D/g, "").slice(0, 12) })
                    }
                    maxLength={12}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>БИН (12 цифр)</Label>
                  <Input
                    value={form.bin}
                    onChange={(e) =>
                      setForm({ ...form, bin: e.target.value.replace(/\D/g, "").slice(0, 12) })
                    }
                    maxLength={12}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Возраст</Label>
                <Input
                  type="number"
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Документ</Label>
                <Input
                  value={form.document_number}
                  onChange={(e) =>
                    setForm({ ...form, document_number: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Заметки</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                Сохранить
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
