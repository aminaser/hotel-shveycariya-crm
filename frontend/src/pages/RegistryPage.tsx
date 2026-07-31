import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { apiFetch, ApiError } from "@/api/client";
import type { Client, RegistrySummary, Room, Stay, StayType, PaymentStatus } from "@/api/types";
import { AuthorFilter } from "@/components/AuthorFilter";
import { AuthorshipMeta } from "@/components/AuthorshipMeta";
import { ClientProfileSheet } from "@/components/ClientProfileSheet";
import { PaymentMethodSelect } from "@/components/PaymentMethodSelect";
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
import {
  nightsBetween,
  stayAmountFromRate,
  todayLocal,
  ALUMNI_PRICE_PER_PERSON,
  ALUMNI_PACKAGE_INCLUDES,
  alumniPackageAmount,
} from "@/lib/dates";
import { groupStays, newGroupId, pickPaymentPrimaryStay, pickPaymentWriteTarget, staysInLogicalGroup } from "@/lib/stay-groups";
import {
  copyToClipboard,
  csvEscape,
  formatDate,
  formatMoney,
  paymentStatusLabel,
  roomStatusLabel,
  stayTypeLabel,
} from "@/lib/format";
import {
  formatPaymentMethod,
  resolvePaymentMethod,
  splitPaymentMethod,
} from "@/lib/payment-method";
import { cn } from "@/lib/utils";
import { canManagePrices, useAuthStore } from "@/stores/auth";

interface AlumniPrices {
  price_per_person: number;
}
type Filter = "all" | "today" | "week" | "unpaid" | "active" | "checkout_today";
type PaymentFilter = "all" | "cash" | "kaspi" | "halyk" | "other";

const emptyForm = () => ({
  client_id: "",
  room_ids: [] as string[],
  record_date: todayLocal(),
  stay_type: "booking" as StayType,
  check_in: todayLocal(),
  planned_check_out: "",
  people_count: "1",
  payment_amount: "",
  prepayment: "",
  payment_status: "unpaid" as PaymentStatus,
  payment_method_preset: "cash",
  payment_method_custom: "",
  payment_date: "",
  phone: "",
  iin: "",
  notes: "",
});

type PayForm = {
  payment_amount: string;
  prepayment: string;
  payment_status: PaymentStatus;
  payment_method_preset: string;
  payment_method_custom: string;
  payment_date: string;
};

const emptyPayForm = (
  stay?: Stay | null,
  group: Stay[] = [],
  alumniPrice: number = ALUMNI_PRICE_PER_PERSON,
): PayForm => {
  const members = group.length > 0 ? group : stay ? [stay] : [];
  const primary = stay ?? members[0] ?? null;
  const { preset, customText } = splitPaymentMethod(
    primary?.payment_method ?? "cash",
  );
  const totalPrepay = members.reduce(
    (sum, s) => sum + (parseFloat(s.prepayment || "0") || 0),
    0,
  );
  // For multi-room / alumni show prepayment from the payment-primary room only
  // (duplicates used to make the field look "stuck" at 2×).
  const payPrimary = members.length > 0 ? pickPaymentPrimaryStay(members) : primary;
  const displayPrepay =
    primary?.stay_type === "alumni" || members.length > 1
      ? parseFloat(payPrimary?.prepayment || "0") || 0
      : totalPrepay;
  const packageOrSum =
    primary?.stay_type === "alumni"
      ? alumniPackageAmount(primary.people_count ?? 1, alumniPrice)
      : String(
          Math.round(
            members.reduce(
              (sum, s) => sum + (parseFloat(s.payment_amount) || 0),
              0,
            ),
          ) || parseFloat(primary?.payment_amount || "0") || 0,
        );
  const anyPartial = members.some((s) => s.payment_status === "partial");
  const allPaid =
    members.length > 0 && members.every((s) => s.payment_status === "paid");
  return {
    payment_amount: packageOrSum === "0" ? primary?.payment_amount ?? "" : packageOrSum,
    prepayment: anyPartial && displayPrepay > 0 ? String(Math.round(displayPrepay)) : "",
    payment_status: allPaid ? "paid" : anyPartial || displayPrepay > 0 ? "partial" : "paid",
    payment_method_preset: preset || "cash",
    payment_method_custom: customText,
    payment_date: payPrimary?.payment_date || primary?.payment_date || todayLocal(),
  };
};

function mutationError(error: unknown, fallback: string) {
  if (error instanceof ApiError) toast.error(error.message);
  else toast.error(fallback);
}

export function RegistryPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEditPrices = canManagePrices(user);
  const [filter, setFilter] = useState<Filter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [authorId, setAuthorId] = useState<number | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alumniPriceOpen, setAlumniPriceOpen] = useState(false);
  const [alumniPriceDraft, setAlumniPriceDraft] = useState(String(ALUMNI_PRICE_PER_PERSON));
  const [editStay, setEditStay] = useState<Stay | null>(null);
  /** room_id → stay for the group being edited (to add/remove rooms). */
  const [editOriginalByRoom, setEditOriginalByRoom] = useState<Map<string, Stay>>(
    () => new Map(),
  );
  const [payStay, setPayStay] = useState<Stay | null>(null);
  const [payForm, setPayForm] = useState<PayForm>(emptyPayForm);
  const [checkoutStayRow, setCheckoutStayRow] = useState<Stay | null>(null);
  const [checkoutDate, setCheckoutDate] = useState(todayLocal());
  const [newClientName, setNewClientName] = useState("");
  const [form, setForm] = useState(emptyForm);

  const resetForm = () => {
    setForm(emptyForm());
    setNewClientName("");
    setEditOriginalByRoom(new Map());
  };

  const openEdit = (stay: Stay) => {
    const { preset, customText } = splitPaymentMethod(stay.payment_method);
    const members = staysInLogicalGroup(stay, stays);
    const byRoom = new Map(members.map((s) => [String(s.room_id), s]));
    setEditOriginalByRoom(byRoom);
    setEditStay(stay);
    const room_ids = members.map((s) => String(s.room_id));
    const totalAmount = members.reduce(
      (sum, s) => sum + (parseFloat(s.payment_amount) || 0),
      0,
    );
    const payPrimary = pickPaymentPrimaryStay(members);
    const displayPrepay = parseFloat(payPrimary.prepayment || "0") || 0;
    const peopleCount = stay.people_count ?? 1;
    const paymentStatus = members.some((s) => s.payment_status === "partial")
      ? "partial"
      : members.every((s) => s.payment_status === "paid")
        ? "paid"
        : stay.payment_status;
    setForm({
      client_id: String(stay.client_id),
      room_ids,
      record_date: stay.record_date,
      stay_type: stay.stay_type,
      check_in: stay.check_in ?? stay.record_date,
      planned_check_out: stay.planned_check_out ?? "",
      people_count: String(peopleCount),
      // Alumni package is always people × rate, never sum of room rows.
      payment_amount:
        stay.stay_type === "alumni"
          ? alumniPackageAmount(peopleCount, alumniPrice)
          : totalAmount > 0
            ? String(Math.round(totalAmount))
            : stay.payment_amount,
      prepayment:
        paymentStatus === "partial" && displayPrepay > 0
          ? String(Math.round(displayPrepay))
          : "",
      payment_status: paymentStatus,
      payment_method_preset: preset,
      payment_method_custom: customText,
      payment_date: payPrimary.payment_date ?? stay.payment_date ?? "",
      phone: stay.client_phone ?? "",
      iin: stay.client_iin ?? "",
      notes: stay.notes ?? "",
    });
    setDialogOpen(true);
  };

  const openPay = (stay: Stay) => {
    const group = staysInLogicalGroup(stay, stays);
    setPayStay(stay);
    setPayForm(emptyPayForm(stay, group, alumniPrice));
  };

  const openCheckout = (stay: Stay) => {
    setCheckoutStayRow(stay);
    setCheckoutDate(stay.check_out || todayLocal());
  };

  const filterParam = filter === "all" ? "" : filter;
  const paymentFilterParam = paymentFilter === "all" ? "" : paymentFilter;
  const { data: stays = [], isLoading } = useQuery({
    queryKey: ["stays", filter, paymentFilter, search, dateFrom, dateTo, authorId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterParam) params.set("filter", filterParam);
      if (paymentFilterParam) params.set("payment_method", paymentFilterParam);
      if (search) params.set("search", search);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (authorId != null) params.set("author_id", String(authorId));
      const qs = params.toString();
      return apiFetch<Stay[]>(`/stays${qs ? `?${qs}` : ""}`);
    },
  });

  const stayGroups = useMemo(() => groupStays(stays), [stays]);

  const staysInGroup = (stay: Stay): Stay[] => staysInLogicalGroup(stay, stays);

  const { data: summary } = useQuery({
    queryKey: ["stays-summary"],
    queryFn: () => apiFetch<RegistrySummary>("/stays/summary"),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => apiFetch<Client[]>("/clients"),
  });

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms"],
    queryFn: () => apiFetch<Room[]>("/rooms"),
  });

  const { data: alumniPrices } = useQuery({
    queryKey: ["alumni-prices"],
    queryFn: () => apiFetch<AlumniPrices>("/alumni-prices"),
    staleTime: 30_000,
  });
  const alumniPrice = alumniPrices?.price_per_person ?? ALUMNI_PRICE_PER_PERSON;
  const alumniAmount = (people: number) => alumniPackageAmount(people, alumniPrice);

  useEffect(() => {
    if (!alumniPriceOpen) return;
    setAlumniPriceDraft(String(Math.round(alumniPrice)));
  }, [alumniPriceOpen, alumniPrice]);

  const saveAlumniPrice = useMutation({
    mutationFn: () =>
      apiFetch<AlumniPrices>("/alumni-prices", {
        method: "PUT",
        body: JSON.stringify({
          price_per_person: Math.max(0, Number(alumniPriceDraft) || 0),
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["alumni-prices"], data);
      toast.success("Цена встречи выпускников сохранена");
      setAlumniPriceOpen(false);
    },
    onError: (e) => mutationError(e, "Не удалось сохранить цену"),
  });

  const amountForRoom = (
    roomId: string,
    checkIn: string,
    checkOut: string,
  ): string => {
    const room = rooms.find((r) => String(r.id) === roomId);
    if (!room?.price_per_night) return "";
    return stayAmountFromRate(room.price_per_night, checkIn, checkOut || null);
  };

  const totalAmountForRooms = (
    roomIds: string[],
    checkIn: string,
    checkOut: string,
  ): string => {
    const total = roomIds.reduce((sum, id) => {
      const amt = parseFloat(amountForRoom(id, checkIn, checkOut));
      return sum + (Number.isFinite(amt) ? amt : 0);
    }, 0);
    return total > 0 ? String(Math.round(total)) : "";
  };

  const applyRoomRates = (
    next: ReturnType<typeof emptyForm>,
    roomIds: string[],
    checkIn: string,
    checkOut: string,
  ) => {
    if (next.stay_type === "alumni") {
      return {
        ...next,
        payment_amount: alumniAmount(parseInt(next.people_count, 10) || 1),
      };
    }
    if (roomIds.length === 0) return { ...next, payment_amount: "" };
    return {
      ...next,
      payment_amount: totalAmountForRooms(roomIds, checkIn, checkOut),
    };
  };

  const setStayType = (stay_type: StayType) => {
    const people_count =
      stay_type === "alumni" ? form.people_count || "1" : form.people_count;
    const next = { ...form, stay_type, people_count };
    if (stay_type === "alumni") {
      setForm({
        ...next,
        payment_amount: alumniAmount(parseInt(people_count, 10) || 1),
      });
      return;
    }
    setForm(
      applyRoomRates(next, next.room_ids, next.check_in, next.planned_check_out),
    );
  };

  const setPeopleCount = (raw: string) => {
    const cleaned = raw.replace(/\D/g, "").slice(0, 3);
    const people_count = cleaned || "";
    const next = { ...form, people_count };
    if (form.stay_type === "alumni") {
      const n = parseInt(people_count, 10) || 1;
      setForm({ ...next, payment_amount: alumniAmount(n) });
      return;
    }
    setForm(next);
  };

  const toggleRoom = (roomId: string) => {
    const selected = form.room_ids.includes(roomId)
      ? form.room_ids.filter((id) => id !== roomId)
      : [...form.room_ids, roomId];
    if (selected.length === 0) {
      toast.error("Оставьте хотя бы один номер");
      return;
    }
    const next = { ...form, room_ids: selected };
    setForm(applyRoomRates(next, selected, next.check_in, next.planned_check_out));
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["stays"] });
    queryClient.invalidateQueries({ queryKey: ["stays-summary"] });
    queryClient.invalidateQueries({ queryKey: ["rooms"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
  };

  const syncClientDetails = async (clientId: number) => {
    const existing = clients.find((c) => c.id === clientId);
    const nextPhone = form.phone.trim() || null;
    const nextIin = form.iin.trim() || null;
    const phoneChanged = !existing || nextPhone !== (existing.phone ?? null);
    const iinChanged = !existing || nextIin !== (existing.iin ?? null);
    if (!phoneChanged && !iinChanged) return;

    await apiFetch(`/clients/${clientId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(phoneChanged ? { phone: nextPhone } : {}),
        ...(iinChanged ? { iin: nextIin } : {}),
      }),
    });
  };

  const buildStayPayload = (
    clientId: number,
    roomId: number,
    paymentAmount: string,
    peopleCount: number,
    prepaymentAmount: string,
    groupId: string | null = null,
  ) => ({
    client_id: clientId,
    room_id: roomId,
    record_date: form.record_date,
    stay_type: form.stay_type,
    check_in: form.check_in || null,
    planned_check_out: form.planned_check_out || null,
    people_count: peopleCount,
    payment_amount: paymentAmount || "0",
    prepayment:
      form.payment_status === "partial" ? prepaymentAmount || "0" : "0",
    payment_status: form.payment_status,
    payment_method: resolvePaymentMethod(
      form.payment_method_preset,
      form.payment_method_custom,
    ),
    payment_date:
      form.payment_status === "unpaid"
        ? null
        : form.payment_date || todayLocal(),
    group_id: groupId,
    notes: form.notes || null,
  });

  const validateForm = (): boolean => {
    if (form.room_ids.length === 0) {
      toast.error("Выберите хотя бы один номер");
      return false;
    }
    if (!editStay && !form.client_id && !newClientName.trim()) {
      toast.error("Выберите клиента или введите ФИО");
      return false;
    }
    if (form.stay_type === "alumni") {
      const people = parseInt(form.people_count, 10);
      if (!people || people < 1) {
        toast.error("Укажите количество человек");
        return false;
      }
    }
    if (form.payment_status === "partial") {
      const prepay = parseFloat(form.prepayment);
      if (!Number.isFinite(prepay) || prepay <= 0) {
        toast.error("Укажите сумму предоплаты");
        return false;
      }
      const total = parseFloat(form.payment_amount || "0");
      if (Number.isFinite(total) && total > 0 && prepay > total) {
        toast.error("Предоплата не может быть больше общей суммы");
        return false;
      }
    }
    if (
      form.planned_check_out &&
      form.check_in &&
      form.planned_check_out < form.check_in
    ) {
      toast.error("Дата выезда не может быть раньше заезда");
      return false;
    }
    return true;
  };

  const createStay = useMutation({
    mutationFn: async () => {
      if (!validateForm()) throw new Error("validation");

      let clientId = form.client_id ? parseInt(form.client_id, 10) : null;
      if (!clientId && newClientName.trim()) {
        const client = await apiFetch<Client>("/clients", {
          method: "POST",
          body: JSON.stringify({
            full_name: newClientName.trim(),
            phone: form.phone.trim() || null,
            iin: form.iin.trim() || null,
          }),
        });
        clientId = client.id;
      }
      if (!clientId) throw new Error("Выберите или создайте клиента");

      await syncClientDetails(clientId);

      const roomIds = form.room_ids;
      const people =
        form.stay_type === "alumni"
          ? Math.max(1, parseInt(form.people_count, 10) || 1)
          : 1;
      const packageTotal =
        form.stay_type === "alumni"
          ? alumniAmount(people)
          : null;
      const multi = roomIds.length > 1;
      const groupId = multi ? newGroupId() : null;
      // Lowest selected room holds package / prepayment (stable, not API order).
      const primaryRoomId =
        multi || packageTotal != null
          ? [...roomIds].sort((a, b) => {
              const ra = rooms.find((r) => String(r.id) === a);
              const rb = rooms.find((r) => String(r.id) === b);
              return (
                (Number(ra?.number) || 0) - (Number(rb?.number) || 0) ||
                (ra?.number ?? "").localeCompare(rb?.number ?? "", "ru")
              );
            })[0]
          : roomIds[0];

      for (let i = 0; i < roomIds.length; i++) {
        const roomIdStr = roomIds[i];
        const roomId = parseInt(roomIdStr, 10);
        const isPrimary = roomIdStr === primaryRoomId;
        let amount: string;
        let paymentStatus = form.payment_status;
        let prepayment =
          form.payment_status === "partial" && isPrimary
            ? form.prepayment || "0"
            : "0";
        if (packageTotal != null) {
          if (isPrimary) amount = packageTotal;
          else {
            amount = "0";
            paymentStatus = "unpaid";
            prepayment = "0";
          }
        } else if (multi) {
          amount = amountForRoom(roomIdStr, form.check_in, form.planned_check_out) || "0";
          if (!isPrimary && form.payment_status === "partial") {
            paymentStatus = "unpaid";
            prepayment = "0";
          }
        } else {
          amount = form.payment_amount || "0";
        }
        await apiFetch("/stays", {
          method: "POST",
          body: JSON.stringify({
            ...buildStayPayload(
              clientId,
              roomId,
              amount,
              people,
              prepayment,
              groupId,
            ),
            payment_status: paymentStatus,
            prepayment: paymentStatus === "partial" ? prepayment : "0",
            payment_date:
              paymentStatus === "unpaid"
                ? null
                : form.payment_date || todayLocal(),
          }),
        });
      }
      return roomIds.length;
    },
    onSuccess: (count) => {
      toast.success(
        count > 1 ? `Добавлена единая запись на ${count} номера` : "Запись добавлена",
      );
      setDialogOpen(false);
      setEditStay(null);
      resetForm();
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось добавить запись");
    },
  });

  const updateStay = useMutation({
    mutationFn: async () => {
      if (!editStay) throw new Error("Нет записи");
      if (!validateForm()) throw new Error("validation");
      // Snapshot form at click time — avoid stale closure after HMR / refetch.
      const snap = { ...form };

      const clientId = parseInt(snap.client_id, 10);
      await syncClientDetails(clientId);

      const people =
        snap.stay_type === "alumni"
          ? Math.max(1, parseInt(snap.people_count, 10) || 1)
          : Math.max(1, parseInt(snap.people_count, 10) || 1);

      const selected = snap.room_ids;
      const originalRoomIds = [...editOriginalByRoom.keys()];
      const added = selected.filter((id) => !editOriginalByRoom.has(id));
      const removed = originalRoomIds.filter((id) => !selected.includes(id));

      let groupId = editStay.group_id;
      if (selected.length > 1 && !groupId) {
        groupId = newGroupId();
      }
      if (selected.length === 1 && added.length === 0 && removed.length === 0) {
        groupId = editStay.group_id;
      }

      const sharedPatch = {
        client_id: clientId,
        record_date: snap.record_date,
        stay_type: snap.stay_type,
        check_in: snap.check_in || null,
        planned_check_out: snap.planned_check_out || null,
        people_count: people,
        payment_method: resolvePaymentMethod(
          snap.payment_method_preset,
          snap.payment_method_custom,
        ),
        notes: snap.notes || null,
        ...(groupId ? { group_id: groupId } : {}),
      };

      const selectedStays = selected
        .map((id) => editOriginalByRoom.get(id))
        .filter((s): s is Stay => Boolean(s));
      // Always write money onto the lowest room so display/read stay in sync.
      const payPrimary = pickPaymentWriteTarget(
        selectedStays.length > 0 ? selectedStays : [editStay],
      );

      const patchStay = async (
        existing: Stay,
        isPrimary: boolean,
      ) => {
        const multi = selected.length > 1;
        let paymentStatus = snap.payment_status;
        let prepayment = "0";
        let paymentAmount =
          selected.length === 1
            ? snap.payment_amount || existing.payment_amount
            : existing.payment_amount;

        if (snap.stay_type === "alumni") {
          paymentAmount = isPrimary ? alumniAmount(people) : "0";
          if (!isPrimary) paymentStatus = "unpaid";
        } else if (multi && snap.payment_status === "partial" && !isPrimary) {
          paymentStatus = "unpaid";
        }

        if (snap.payment_status === "partial" && isPrimary) {
          prepayment = snap.prepayment || "0";
        }

        await apiFetch(`/stays/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...sharedPatch,
            room_id: existing.room_id,
            payment_amount: paymentAmount,
            payment_status: paymentStatus,
            prepayment: paymentStatus === "partial" ? prepayment : "0",
            payment_date:
              paymentStatus === "unpaid"
                ? null
                : snap.payment_date || todayLocal(),
          }),
        });
      };

      // Primary first (so backend sibling-clear sees the money row), then the rest.
      const primaryExisting = selectedStays.find((s) => s.id === payPrimary.id);
      if (primaryExisting) {
        await patchStay(primaryExisting, true);
      }
      for (const roomIdStr of selected) {
        const existing = editOriginalByRoom.get(roomIdStr);
        if (!existing || existing.id === payPrimary.id) continue;
        await patchStay(existing, false);
      }

      // Create stays for newly added rooms.
      for (const roomIdStr of added) {
        const roomId = parseInt(roomIdStr, 10);
        const amount =
          snap.stay_type === "alumni"
            ? "0"
            : amountForRoom(roomIdStr, snap.check_in, snap.planned_check_out) ||
              "0";
        await apiFetch("/stays", {
          method: "POST",
          body: JSON.stringify({
            ...buildStayPayload(
              clientId,
              roomId,
              amount,
              people,
              "0",
              groupId,
            ),
            payment_status:
              snap.stay_type === "alumni" ? "unpaid" : snap.payment_status,
            prepayment: "0",
            payment_date:
              snap.stay_type === "alumni" || snap.payment_status === "unpaid"
                ? null
                : snap.payment_date || todayLocal(),
          }),
        });
      }

      // Remove deselected rooms from the group.
      for (const roomIdStr of removed) {
        const existing = editOriginalByRoom.get(roomIdStr);
        if (!existing) continue;
        await apiFetch(`/stays/${existing.id}`, { method: "DELETE" });
      }

      return { added: added.length, removed: removed.length };
    },
    onSuccess: ({ added, removed }) => {
      const parts = ["Запись обновлена"];
      if (added > 0) parts.push(`добавлено номеров: ${added}`);
      if (removed > 0) parts.push(`убрано: ${removed}`);
      toast.success(parts.join(", "));
      setDialogOpen(false);
      setEditStay(null);
      resetForm();
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось обновить запись");
    },
  });

  const deleteStay = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await apiFetch(`/stays/${id}`, { method: "DELETE" });
      }
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(count > 1 ? `Удалено записей: ${count}` : "Запись удалена");
      invalidateAll();
    },
    onError: (e) => mutationError(e, "Не удалось удалить запись"),
  });

  const checkoutStay = useMutation({
    mutationFn: async () => {
      if (!checkoutStayRow) throw new Error("Нет записи");
      if (!checkoutDate) {
        toast.error("Укажите дату выезда");
        throw new Error("validation");
      }
      const group = staysInGroup(checkoutStayRow);
      const targets = group.filter((s) => {
        const checkIn = s.check_in || s.record_date;
        return checkoutDate >= checkIn;
      });
      if (targets.length === 0) {
        toast.error("Дата выезда не может быть раньше заезда");
        throw new Error("validation");
      }
      for (const s of targets) {
        const checkIn = s.check_in || s.record_date;
        if (checkoutDate < checkIn) continue;
        await apiFetch(`/stays/${s.id}/checkout`, {
          method: "POST",
          body: JSON.stringify({ check_out: checkoutDate }),
        });
      }
      return targets.length;
    },
    onSuccess: (count) => {
      toast.success(
        checkoutStayRow?.check_out
          ? "Дата выезда обновлена"
          : count > 1
            ? `Выезд оформлен по ${count} номерам`
            : "Выезд оформлен, номер на уборку",
      );
      setCheckoutStayRow(null);
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось оформить выезд");
    },
  });

  const undoCheckout = useMutation({
    mutationFn: async () => {
      if (!checkoutStayRow) throw new Error("Нет записи");
      const group = staysInGroup(checkoutStayRow);
      const targets = group.filter((s) => s.check_out != null);
      for (const s of targets) {
        await apiFetch(`/stays/${s.id}/undo-checkout`, { method: "POST" });
      }
      return targets.length;
    },
    onSuccess: (count) => {
      toast.success(
        count > 1
          ? `Выезд отменён по ${count} номерам`
          : "Выезд отменён, гость снова в номере",
      );
      setCheckoutStayRow(null);
      invalidateAll();
    },
    onError: (e) => mutationError(e, "Не удалось отменить выезд"),
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      if (!payStay) throw new Error("Нет записи");
      const snap = { ...payForm };
      if (!snap.payment_date) {
        toast.error("Укажите дату оплаты");
        throw new Error("validation");
      }
      if (snap.payment_status === "partial") {
        const prepay = parseFloat(snap.prepayment);
        if (!Number.isFinite(prepay) || prepay <= 0) {
          toast.error("Укажите сумму предоплаты");
          throw new Error("validation");
        }
        const total = parseFloat(snap.payment_amount || "0");
        if (Number.isFinite(total) && total > 0 && prepay > total) {
          toast.error("Предоплата не может быть больше общей суммы");
          throw new Error("validation");
        }
      }
      const group = staysInGroup(payStay);
      const method = resolvePaymentMethod(
        snap.payment_method_preset,
        snap.payment_method_custom,
      );
      const packageTotal =
        payStay.stay_type === "alumni"
          ? alumniAmount(payStay.people_count ?? 1)
          : null;
      const multi = group.length > 1;
      const groupId =
        multi && !payStay.group_id ? newGroupId() : payStay.group_id;
      const payPrimary = pickPaymentWriteTarget(group);

      const patchOne = async (s: Stay, isPrimary: boolean) => {
        let paymentStatus = snap.payment_status;
        let prepayment = "0";
        let paymentAmount = s.payment_amount;

        if (packageTotal != null) {
          paymentAmount = isPrimary ? packageTotal : "0";
          if (!isPrimary) paymentStatus = "unpaid";
        } else if (multi && snap.payment_status === "partial" && !isPrimary) {
          paymentStatus = "unpaid";
        } else if (!multi && snap.payment_amount) {
          paymentAmount = snap.payment_amount;
        }

        if (snap.payment_status === "partial" && isPrimary) {
          prepayment = snap.prepayment || "0";
        }

        await apiFetch(`/stays/${s.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            payment_status: paymentStatus,
            payment_amount: paymentAmount,
            prepayment: paymentStatus === "partial" ? prepayment : "0",
            payment_method: method,
            payment_date:
              paymentStatus === "unpaid" ? null : snap.payment_date,
            ...(groupId ? { group_id: groupId } : {}),
          }),
        });
      };

      await patchOne(payPrimary, true);
      for (const s of group) {
        if (s.id === payPrimary.id) continue;
        await patchOne(s, false);
      }
      return group.length;
    },
    onSuccess: () => {
      toast.success("Оплата зафиксирована");
      setPayStay(null);
      invalidateAll();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "validation") return;
      mutationError(e, "Не удалось сохранить оплату");
    },
  });

  const exportCsv = () => {
    const header =
      "Дата,ФИО,ИИН,Комната,Тип,Человек,Заезд,Выезд,Сумма,Предоплата,Статус,Дата оплаты,Способ оплаты,Телефон\n";
    const rows = stays
      .map((s) =>
        [
          s.record_date,
          csvEscape(s.client_name),
          s.client_iin ?? "",
          s.room_number,
          stayTypeLabel[s.stay_type],
          s.stay_type === "alumni" ? String(s.people_count ?? 1) : "",
          s.check_in ?? "",
          s.planned_check_out ?? "",
          s.payment_amount,
          s.payment_status === "partial" ? s.prepayment || "0" : "",
          paymentStatusLabel[s.payment_status],
          s.payment_date ?? "",
          csvEscape(formatPaymentMethod(s.payment_method)),
          s.client_phone ?? "",
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal_${todayLocal()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPhone = async (phone: string | null) => {
    if (!phone) return;
    const ok = await copyToClipboard(phone);
    if (ok) toast.success("Телефон скопирован");
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Журнал заселений</h1>
          <p className="text-sm text-muted-foreground">Основной рабочий экран</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditPrices && (
            <Button variant="outline" onClick={() => setAlumniPriceOpen(true)}>
              <Pencil className="h-4 w-4" />
              Цена выпускников
            </Button>
          )}
          <Button variant="outline" onClick={exportCsv}>
            Экспорт CSV
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setEditStay(null);
              setDialogOpen(true);
            }}
          >
            + Новая запись
          </Button>
        </div>
      </div>

      {summary && (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Заселения сегодня", value: summary.today_checkins },
              { label: "Выручка сегодня (по дате оплаты)", value: formatMoney(summary.today_payments_kzt) },
              { label: "Выезды сегодня", value: summary.today_checkouts },
              { label: "Занято номеров", value: `${summary.occupied_rooms}/${summary.total_rooms}` },
              { label: "Всего записей", value: summary.total_records },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Касса за сегодня (оплачено)
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Наличка: {formatMoney(summary.payments_by_method.cash)}</span>
              <span>Kaspi: {formatMoney(summary.payments_by_method.kaspi)}</span>
              <span>Halyk: {formatMoney(summary.payments_by_method.halyk)}</span>
              <span>Другое: {formatMoney(summary.payments_by_method.other)}</span>
            </div>
          </div>
        </>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "Все"],
            ["today", "Сегодня"],
            ["week", "Эта неделя"],
            ["active", "В номере"],
            ["checkout_today", "Выезд сегодня"],
            ["unpaid", "Неоплаченные"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
        <Input
          className="max-w-[140px]"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Дата с"
        />
        <Input
          className="max-w-[140px]"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Дата по"
        />
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            Сбросить даты
          </Button>
        )}
        <AuthorFilter value={authorId} onChange={setAuthorId} />
        <Input
          className="max-w-xs"
          placeholder="Поиск ФИО, телефон, ИИН, комната..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={paymentFilter}
          onValueChange={(v) => setPaymentFilter(v as PaymentFilter)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Способ оплаты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все способы</SelectItem>
            <SelectItem value="cash">Наличка</SelectItem>
            <SelectItem value="kaspi">Kaspi</SelectItem>
            <SelectItem value="halyk">Halyk</SelectItem>
            <SelectItem value="other">Свой вариант</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Дата</th>
              <th className="px-4 py-3 text-left font-medium">ФИО</th>
              <th className="px-4 py-3 text-left font-medium">ИИН</th>
              <th className="px-4 py-3 text-left font-medium">№ комнаты</th>
              <th className="px-4 py-3 text-left font-medium">Тип</th>
              <th className="px-4 py-3 text-left font-medium">Заезд / Выезд</th>
              <th className="px-4 py-3 text-left font-medium">Оплата</th>
              <th className="px-4 py-3 text-left font-medium">Дата оплаты</th>
              <th className="px-4 py-3 text-left font-medium">Способ</th>
              <th className="px-4 py-3 text-left font-medium">Телефон</th>
              <th className="px-4 py-3 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                  Загрузка...
                </td>
              </tr>
            ) : stayGroups.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                  Нет записей
                </td>
              </tr>
            ) : (
              stayGroups.map((group) => {
                const stay = group.primary;
                const roomsLabel = group.roomNumbers;
                return (
                <tr key={group.key} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div>{formatDate(stay.record_date)}</div>
                    {group.anyInRoom && (
                      <Badge variant="warning" className="mt-1 text-[10px]">
                        В номере
                      </Badge>
                    )}
                    {!group.anyInRoom && group.anyBookedFuture && (
                      <Badge variant="default" className="mt-1 text-[10px]">
                        Бронь
                      </Badge>
                    )}
                    {group.anyCheckoutToday && group.anyInRoom && (
                      <Badge variant="default" className="mt-1 text-[10px]">
                        Выезд сегодня
                      </Badge>
                    )}
                    {group.anyCheckoutToday && !group.anyInRoom && !group.allCheckedOut && (
                      <Badge variant="success" className="mt-1 text-[10px]">
                        Свободен с 12:00
                      </Badge>
                    )}
                    {group.allCheckedOut && (
                      <Badge variant="muted" className="mt-1 text-[10px]">
                        Выехал
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setSelectedClientId(stay.client_id)}
                    >
                      {stay.client_name}
                    </button>
                    <AuthorshipMeta
                      className="mt-1"
                      createdByName={stay.created_by_name}
                      createdAt={stay.created_at}
                      updatedByName={stay.updated_by_name}
                      updatedAt={stay.updated_at}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {stay.client_iin ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{roomsLabel}</span>
                    {group.stays.length > 1 && (
                      <div className="text-xs text-muted-foreground">
                        {group.stays.length} номера
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        stay.stay_type === "booking"
                          ? "default"
                          : stay.stay_type === "alumni"
                            ? "success"
                            : "warning"
                      }
                    >
                      {stayTypeLabel[stay.stay_type]}
                    </Badge>
                    {stay.stay_type === "alumni" && stay.people_count > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {stay.people_count} чел.
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {stay.check_in ? formatDate(stay.check_in) : "—"}
                    {" → "}
                    {stay.planned_check_out
                      ? formatDate(stay.planned_check_out)
                      : "—"}
                    {stay.check_out
                      ? ` · оформлен ${formatDate(stay.check_out)}`
                      : ""}
                  </td>
                  <td className="px-4 py-3">
                    <div>{formatMoney(group.totalAmount)}</div>
                    <div className="text-xs text-muted-foreground">
                      {paymentStatusLabel[group.paymentStatus]}
                    </div>
                    {group.paymentStatus === "partial" &&
                      group.totalPrepayment > 0 && (
                        <div className="text-xs text-emerald-700">
                          Предоплата: {formatMoney(group.totalPrepayment)}
                        </div>
                      )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {stay.payment_date ? formatDate(stay.payment_date) : "—"}
                  </td>
                  <td className="px-4 py-3">{formatPaymentMethod(stay.payment_method)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span>{stay.client_phone ?? "—"}</span>
                      {stay.client_phone && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => handleCopyPhone(stay.client_phone)}
                          title="Копировать телефон"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {group.paymentStatus !== "paid" && (
                        <Button size="sm" variant="outline" onClick={() => openPay(stay)}>
                          Оплата
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openCheckout(stay)}>
                        {group.allCheckedOut ? "Изменить выезд" : "Выезд"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(stay)}>
                        Изменить
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          const ids = group.stays.map((s) => s.id);
                          const msg =
                            group.stays.length > 1
                              ? `Удалить объединённую запись по номерам ${roomsLabel}?`
                              : "Удалить запись?";
                          if (confirm(msg)) deleteStay.mutate(ids);
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ClientProfileSheet
        clientId={selectedClientId}
        onClose={() => setSelectedClientId(null)}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditStay(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto" closeOnOutsideClick={false}>
          <DialogHeader>
            <DialogTitle>{editStay ? "Редактировать запись" : "Новая запись"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editStay ? (
              <>
                <div className="space-y-2">
                  <Label>Клиент</Label>
                  <Select
                    value={form.client_id}
                    onValueChange={(v) => {
                      const client = clients.find((c) => String(c.id) === v);
                      setForm({
                        ...form,
                        client_id: v,
                        phone: client?.phone ?? "",
                        iin: client?.iin ?? "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите клиента" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.full_name}
                          {c.iin ? ` · ${c.iin}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Или новый клиент (ФИО)</Label>
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    disabled={!!form.client_id}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{editStay.client_name}</div>
                {editStay.client_iin && (
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    ИИН: {editStay.client_iin}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+7 7xx xxx xx xx"
              />
            </div>
            <div className="space-y-2">
              <Label>ИИН (12 цифр)</Label>
              <Input
                value={form.iin}
                onChange={(e) =>
                  setForm({
                    ...form,
                    iin: e.target.value.replace(/\D/g, "").slice(0, 12),
                  })
                }
                placeholder="000000000000"
                maxLength={12}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-2">
              <Label>Номера комнат</Label>
              <p className="text-xs text-muted-foreground">
                {editStay
                  ? "Можно добавить или убрать номера — запись останется одной в журнале"
                  : "Можно выбрать несколько номеров на одного гостя — в журнале будет одна запись"}
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {rooms.map((r) => {
                  const id = String(r.id);
                  const selected = form.room_ids.includes(id);
                  const alreadyInGroup = editOriginalByRoom.has(id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRoom(id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span>
                        №{r.number}
                        {r.room_type ? ` · ${r.room_type}` : ""}
                        {" · "}
                        {roomStatusLabel[r.status]}
                        {r.current_guest ? ` (${r.current_guest})` : ""}
                        {alreadyInGroup && editStay ? " · в записи" : ""}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          selected
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {r.price_per_night
                          ? `${Number(r.price_per_night).toLocaleString("ru-KZ")} ₸/сут.`
                          : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {form.room_ids.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Выбрано:{" "}
                  {form.room_ids
                    .map((id) => {
                      const room = rooms.find((r) => String(r.id) === id);
                      return room ? `№${room.number}` : id;
                    })
                    .join(", ")}
                </p>
              )}
              {form.room_ids.length > 0 && form.stay_type !== "alumni" && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {form.room_ids.map((id) => {
                    const room = rooms.find((r) => String(r.id) === id);
                    if (!room) return null;
                    const nights = nightsBetween(
                      form.check_in,
                      form.planned_check_out || null,
                    );
                    const amt = amountForRoom(
                      id,
                      form.check_in,
                      form.planned_check_out,
                    );
                    return (
                      <p key={id}>
                        №{room.number}:{" "}
                        {room.price_per_night
                          ? `${Number(room.price_per_night).toLocaleString("ru-KZ")} ₸/сут. · ${nights} сут.${amt ? ` · ${Number(amt).toLocaleString("ru-KZ")} ₸` : ""}`
                          : "цена за сутки не задана"}
                        {" · завтрак включён · выезд 12:00 · заезд 13:00"}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата записи</Label>
                <Input
                  type="date"
                  value={form.record_date}
                  onChange={(e) => setForm({ ...form, record_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Тип</Label>
                <Select
                  value={form.stay_type}
                  onValueChange={(v) => setStayType(v as StayType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="booking">Бронь</SelectItem>
                    <SelectItem value="extension">Продление</SelectItem>
                    <SelectItem value="alumni">Встреча выпускников</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.stay_type === "alumni" && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="space-y-2">
                  <Label>Количество человек</Label>
                  <Input
                    type="number"
                    min="1"
                    max="500"
                    value={form.people_count}
                    onChange={(e) => setPeopleCount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {alumniPrice.toLocaleString("ru-KZ")} ₸ ×{" "}
                    {Math.max(1, parseInt(form.people_count, 10) || 1)} ={" "}
                    {Number(
                      alumniAmount(parseInt(form.people_count, 10) || 1),
                    ).toLocaleString("ru-KZ")}{" "}
                    ₸
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  В пакет входит: {ALUMNI_PACKAGE_INCLUDES}
                </p>
                <p className="text-xs text-muted-foreground">
                  Выберите сразу все номера сверху — они попадут в одну запись
                  в журнале и в «Бронь в отеле», а не отдельными строками.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Заезд</Label>
                <Input
                  type="date"
                  value={form.check_in}
                  onChange={(e) => {
                    const check_in = e.target.value;
                    const next = { ...form, check_in };
                    setForm(
                      applyRoomRates(
                        next,
                        next.room_ids,
                        check_in,
                        next.planned_check_out,
                      ),
                    );
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Выезд (план)</Label>
                <Input
                  type="date"
                  value={form.planned_check_out}
                  onChange={(e) => {
                    const planned_check_out = e.target.value;
                    const next = { ...form, planned_check_out };
                    setForm(
                      applyRoomRates(
                        next,
                        next.room_ids,
                        next.check_in,
                        planned_check_out,
                      ),
                    );
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {form.stay_type === "alumni"
                    ? "Сумма пакета (₸)"
                    : form.room_ids.length > 1
                      ? "Сумма всего (₸)"
                      : "Сумма (₸)"}
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={form.payment_amount}
                  onChange={(e) => setForm({ ...form, payment_amount: e.target.value })}
                  disabled={
                    form.stay_type === "alumni" || form.room_ids.length > 1
                  }
                />
                {form.stay_type === "alumni" && (
                  <p className="text-xs text-muted-foreground">
                    Только {alumniPrice.toLocaleString("ru-KZ")} ₸ ×
                    количество человек (номера на сумму не влияют)
                  </p>
                )}
                {form.room_ids.length > 1 && form.stay_type !== "alumni" && (
                  <p className="text-xs text-muted-foreground">
                    При нескольких номерах сумма считается по тарифу каждого номера
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Статус оплаты</Label>
                <Select
                  value={form.payment_status}
                  onValueChange={(v) => {
                    const payment_status = v as PaymentStatus;
                    setForm({
                      ...form,
                      payment_status,
                      payment_date:
                        payment_status === "unpaid"
                          ? ""
                          : form.payment_date || todayLocal(),
                      prepayment:
                        payment_status === "partial" ? form.prepayment : "",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Оплачено</SelectItem>
                    <SelectItem value="partial">Частично</SelectItem>
                    <SelectItem value="unpaid">Не оплачено</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.payment_status === "partial" && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <Label>Предоплата (₸)</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.prepayment}
                  onChange={(e) => setForm({ ...form, prepayment: e.target.value })}
                  placeholder="Сумма предоплаты"
                />
                {form.payment_amount &&
                  parseFloat(form.prepayment || "0") > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Остаток:{" "}
                      {formatMoney(
                        Math.max(
                          0,
                          (parseFloat(form.payment_amount) || 0) -
                            (parseFloat(form.prepayment) || 0),
                        ),
                      )}
                    </p>
                  )}
              </div>
            )}
            {form.payment_status !== "unpaid" && (
              <div className="space-y-2">
                <Label>Дата оплаты</Label>
                <Input
                  type="date"
                  value={form.payment_date}
                  onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  В аналитике выручка считается по дате оплаты
                </p>
              </div>
            )}
            <PaymentMethodSelect
              preset={form.payment_method_preset}
              customText={form.payment_method_custom}
              onPresetChange={(v) => setForm({ ...form, payment_method_preset: v })}
              onCustomTextChange={(v) => setForm({ ...form, payment_method_custom: v })}
            />
            <div className="space-y-2">
              <Label>Заметки</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Дополнительная информация"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => (editStay ? updateStay.mutate() : createStay.mutate())}
              disabled={createStay.isPending || updateStay.isPending}
            >
              {editStay ? "Сохранить изменения" : "Сохранить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payStay !== null}
        onOpenChange={(open) => {
          if (!open) setPayStay(null);
        }}
      >
        <DialogContent className="max-w-md" closeOnOutsideClick={false}>
          <DialogHeader>
            <DialogTitle>Оплата брони</DialogTitle>
          </DialogHeader>
          {payStay && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{payStay.client_name}</div>
                <div className="text-muted-foreground">
                  №
                  {staysInGroup(payStay)
                    .map((s) => s.room_number)
                    .join(", ")}{" "}
                  ·{" "}
                  {formatMoney(
                    payStay.stay_type === "alumni"
                      ? alumniAmount(payStay.people_count ?? 1)
                      : staysInGroup(payStay).reduce(
                          (sum, s) => sum + (parseFloat(s.payment_amount) || 0),
                          0,
                        ),
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Дата оплаты</Label>
                <Input
                  type="date"
                  value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Сумма (₸)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={payForm.payment_amount}
                    onChange={(e) =>
                      setPayForm({ ...payForm, payment_amount: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Статус</Label>
                  <Select
                    value={payForm.payment_status}
                    onValueChange={(v) => {
                      const payment_status = v as PaymentStatus;
                      setPayForm({
                        ...payForm,
                        payment_status,
                        prepayment:
                          payment_status === "partial" ? payForm.prepayment : "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Оплачено</SelectItem>
                      <SelectItem value="partial">Частично</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {payForm.payment_status === "partial" && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                  <Label>Предоплата (₸)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={payForm.prepayment}
                    onChange={(e) =>
                      setPayForm({ ...payForm, prepayment: e.target.value })
                    }
                    placeholder="Сумма предоплаты"
                  />
                  {(payForm.payment_amount || payStay.payment_amount) &&
                    parseFloat(payForm.prepayment || "0") > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Остаток:{" "}
                        {formatMoney(
                          Math.max(
                            0,
                            (parseFloat(
                              payForm.payment_amount || payStay.payment_amount,
                            ) || 0) - (parseFloat(payForm.prepayment) || 0),
                          ),
                        )}
                      </p>
                    )}
                </div>
              )}
              <PaymentMethodSelect
                preset={payForm.payment_method_preset}
                customText={payForm.payment_method_custom}
                onPresetChange={(v) =>
                  setPayForm({ ...payForm, payment_method_preset: v })
                }
                onCustomTextChange={(v) =>
                  setPayForm({ ...payForm, payment_method_custom: v })
                }
              />
              <Button
                className="w-full"
                onClick={() => markPaid.mutate()}
                disabled={markPaid.isPending}
              >
                {markPaid.isPending ? "Сохранение…" : "Сохранить оплату"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={checkoutStayRow !== null}
        onOpenChange={(open) => {
          if (!open) setCheckoutStayRow(null);
        }}
      >
        <DialogContent className="max-w-md" closeOnOutsideClick={false}>
          <DialogHeader>
            <DialogTitle>
              {checkoutStayRow?.check_out ? "Изменить выезд" : "Оформить выезд"}
            </DialogTitle>
          </DialogHeader>
          {checkoutStayRow && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{checkoutStayRow.client_name}</div>
                <div className="text-muted-foreground">
                  №
                  {staysInGroup(checkoutStayRow)
                    .map((s) => s.room_number)
                    .join(", ")}
                  {checkoutStayRow.check_in
                    ? ` · заезд ${formatDate(checkoutStayRow.check_in)}`
                    : ""}
                  {checkoutStayRow.check_out
                    ? ` · выезд оформлен ${formatDate(checkoutStayRow.check_out)}`
                    : ""}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Дата выезда</Label>
                <Input
                  type="date"
                  value={checkoutDate}
                  onChange={(e) => setCheckoutDate(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => checkoutStay.mutate()}
                disabled={checkoutStay.isPending || undoCheckout.isPending}
              >
                {checkoutStay.isPending
                  ? "Сохранение…"
                  : checkoutStayRow.check_out
                    ? "Сохранить дату выезда"
                    : "Подтвердить выезд"}
              </Button>
              {checkoutStayRow.check_out && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    if (
                      confirm(
                        `Отменить выезд для ${checkoutStayRow.client_name}? Гость снова будет считаться в номере.`,
                      )
                    ) {
                      undoCheckout.mutate();
                    }
                  }}
                  disabled={checkoutStay.isPending || undoCheckout.isPending}
                >
                  {undoCheckout.isPending ? "Отмена…" : "Отменить выезд"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={alumniPriceOpen} onOpenChange={setAlumniPriceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Цена встречи выпускников</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Цена за одного человека в пакете. Только для Жибек.
          </p>
          <div className="space-y-2 py-2">
            <Label>Цена за человека, ₸</Label>
            <Input
              type="number"
              min={0}
              value={alumniPriceDraft}
              onChange={(e) => setAlumniPriceDraft(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              В пакет входит: {ALUMNI_PACKAGE_INCLUDES}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlumniPriceOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveAlumniPrice.mutate()}
              disabled={saveAlumniPrice.isPending}
            >
              {saveAlumniPrice.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
