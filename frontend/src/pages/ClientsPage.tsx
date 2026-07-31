import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { Client } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { ClientProfileSheet } from "@/components/ClientProfileSheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

export function ClientsPage() {
  const queryClient = useQueryClient();
  const dedupedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    client_type: "individual" as "individual" | "organization",
    iin: "",
    bin: "",
    age: "",
    document_number: "",
  });

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients", search, authorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (authorId != null) params.set("author_id", String(authorId));
      const qs = params.toString();
      return apiFetch<Client[]>(`/clients${qs ? `?${qs}` : ""}`);
    },
  });

  const dedupeClients = useMutation({
    mutationFn: () =>
      apiFetch<{ merged_groups: number; removed: number }>("/clients/dedupe", {
        method: "POST",
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["stays"] });
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
      if (result.removed > 0) {
        toast.success(
          `Объединены дубликаты: убрано ${result.removed}, групп ${result.merged_groups}`,
        );
      }
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось объединить дубликаты");
    },
  });

  useEffect(() => {
    if (dedupedRef.current) return;
    dedupedRef.current = true;
    dedupeClients.mutate();
    // Run once on open to clean existing duplicates (Ольга×2, Евгения×3, …).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createClient = useMutation({
    mutationFn: () =>
      apiFetch("/clients", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          client_type: form.client_type,
          iin: form.client_type === "individual" ? form.iin || null : null,
          bin: form.client_type === "organization" ? form.bin || null : null,
          age: form.age ? parseInt(form.age, 10) : null,
          document_number: form.document_number.trim() || null,
        }),
      }),
    onSuccess: () => {
      toast.success("Клиент сохранён");
      setOpen(false);
      setForm({
        full_name: "",
        phone: "",
        client_type: "individual",
        iin: "",
        bin: "",
        age: "",
        document_number: "",
      });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Ошибка при добавлении");
    },
  });

  const deleteClient = useMutation({
    mutationFn: (id: number) => apiFetch(`/clients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Клиент удалён");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.message);
      else toast.error("Не удалось удалить клиента");
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Клиентская база</h1>
          <p className="text-sm text-muted-foreground">
            Один человек — одна карточка, даже если занято несколько номеров
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AuthorFilter value={authorId} onChange={setAuthorId} />
          <Button
            variant="outline"
            onClick={() => dedupeClients.mutate()}
            disabled={dedupeClients.isPending}
          >
            {dedupeClients.isPending ? "Объединение…" : "Объединить дубликаты"}
          </Button>
          <Button onClick={() => setOpen(true)}>+ Добавить клиента</Button>
        </div>
      </div>

      <Input
        className="mb-4 max-w-md"
        placeholder="Поиск..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left">ФИО</th>
              <th className="px-4 py-3 text-left">Телефон</th>
              <th className="px-4 py-3 text-left">ИИН / БИН</th>
              <th className="px-4 py-3 text-left">Возраст</th>
              <th className="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Загрузка...
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Клиенты не найдены
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <tr key={client.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setSelectedId(client.id)}
                    >
                      {client.full_name}
                    </button>
                    <AuthorshipMeta
                      className="mt-1"
                      createdByName={client.created_by_name}
                      createdAt={client.created_at}
                      updatedByName={client.updated_by_name}
                      updatedAt={client.updated_at}
                    />
                  </td>
                  <td className="px-4 py-3">{client.phone ?? "—"}</td>
                  <td className="px-4 py-3">{client.iin ?? client.bin ?? "—"}</td>
                  <td className="px-4 py-3">{client.age ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedId(client.id)}
                      >
                        Редактировать
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Удалить клиента?")) deleteClient.mutate(client.id);
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientProfileSheet clientId={selectedId} onClose={() => setSelectedId(null)} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый клиент</DialogTitle>
          </DialogHeader>
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
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Тип</Label>
              <Select
                value={form.client_type}
                onValueChange={(v) =>
                  setForm({ ...form, client_type: v as "individual" | "organization" })
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
            <div className="space-y-2">
              <Label>{form.client_type === "individual" ? "ИИН" : "БИН"}</Label>
              <Input
                value={form.client_type === "individual" ? form.iin : form.bin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                  if (form.client_type === "individual") {
                    setForm({ ...form, iin: val });
                  } else {
                    setForm({ ...form, bin: val });
                  }
                }}
                maxLength={12}
              />
            </div>
            <div className="space-y-2">
              <Label>Возраст</Label>
              <Input
                type="number"
                min={0}
                max={150}
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Документ</Label>
              <Input
                value={form.document_number}
                onChange={(e) => setForm({ ...form, document_number: e.target.value })}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => createClient.mutate()}
              disabled={!form.full_name.trim() || createClient.isPending}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
