import type { PaymentStatus, Stay } from "@/api/types";
import {
  alumniPackageAmount,
  isCheckoutToday,
  isFutureBooking,
  isGuestInRoom,
  isOpenStay,
} from "@/lib/dates";

export interface StayGroup {
  key: string;
  stays: Stay[];
  primary: Stay;
  roomNumbers: string;
  totalAmount: number;
  totalPrepayment: number;
  paymentStatus: PaymentStatus;
  anyInRoom: boolean;
  anyBookedFuture: boolean;
  anyCheckoutToday: boolean;
  allCheckedOut: boolean;
}

export function groupPaymentStatus(stays: Stay[]): PaymentStatus {
  if (stays.every((s) => s.payment_status === "paid")) return "paid";
  if (stays.every((s) => s.payment_status === "unpaid")) return "unpaid";
  return "partial";
}

/** Soft key for alumni rows created separately without group_id (e.g. «Алтын»). */
export function alumniSoftGroupKey(stay: Stay): string | null {
  if (stay.stay_type !== "alumni") return null;
  if (stay.group_id) return null;
  const checkIn = stay.check_in || stay.record_date;
  const checkOut = stay.planned_check_out || "";
  return `alumni:${stay.client_id}:${checkIn}:${checkOut}`;
}

export function stayGroupKey(stay: Stay): string {
  if (stay.group_id) return `g:${stay.group_id}`;
  const soft = alumniSoftGroupKey(stay);
  if (soft) return soft;
  return `s:${stay.id}`;
}

/** All stays that belong to the same logical booking as `stay`. */
export function staysInLogicalGroup(stay: Stay, all: Stay[]): Stay[] {
  if (stay.group_id) {
    const linked = all.filter((s) => s.group_id === stay.group_id);
    return linked.length > 0 ? [...linked].sort(sortByRoom) : [stay];
  }
  const soft = alumniSoftGroupKey(stay);
  if (soft) {
    const linked = all.filter((s) => alumniSoftGroupKey(s) === soft);
    if (linked.length > 1) return [...linked].sort(sortByRoom);
  }
  return [stay];
}

function sortByRoom(a: Stay, b: Stay): number {
  const an = Number(a.room_number) || 0;
  const bn = Number(b.room_number) || 0;
  if (an !== bn) return an - bn;
  return a.room_number.localeCompare(b.room_number, "ru");
}

/**
 * Stay whose prepayment/amount should be shown in the UI for a group.
 * If several rows wrongly hold money, prefer the lowest room that has it.
 */
export function pickPaymentPrimaryStay(members: Stay[]): Stay {
  if (members.length === 0) {
    throw new Error("pickPaymentPrimaryStay: empty group");
  }
  const sorted = [...members].sort(sortByRoom);
  if (sorted.length === 1) return sorted[0];

  const withPrepay = sorted.filter((s) => (parseFloat(s.prepayment) || 0) > 0);
  if (withPrepay.length >= 1) return withPrepay[0];

  const withMoney = sorted.filter(
    (s) => (parseFloat(s.payment_amount) || 0) > 0,
  );
  if (withMoney.length >= 1) return withMoney[0];

  return sorted[0];
}

/** Where package / partial prepayment is written for a multi-room group. */
export function pickPaymentWriteTarget(members: Stay[]): Stay {
  if (members.length === 0) {
    throw new Error("pickPaymentWriteTarget: empty group");
  }
  return [...members].sort(sortByRoom)[0];
}

export function groupStays(stays: Stay[]): StayGroup[] {
  const groups = new Map<string, Stay[]>();
  const order: string[] = [];

  for (const stay of stays) {
    const key = stayGroupKey(stay);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(stay);
  }

  return order.map((key) => {
    const members = [...(groups.get(key) ?? [])].sort(sortByRoom);
    const primary = members[0];
    const payPrimary = pickPaymentPrimaryStay(members);
    const totalAmount =
      primary.stay_type === "alumni"
        ? parseFloat(alumniPackageAmount(primary.people_count ?? 1)) || 0
        : members.reduce(
            (sum, s) => sum + (parseFloat(s.payment_amount) || 0),
            0,
          );
    // Prepayment is stored on one room only — don't sum duplicates across the group.
    const totalPrepayment =
      primary.stay_type === "alumni" || members.length > 1
        ? parseFloat(payPrimary.prepayment || "0") || 0
        : members.reduce(
            (sum, s) => sum + (parseFloat(s.prepayment || "0") || 0),
            0,
          );
    return {
      key,
      stays: members,
      primary,
      roomNumbers: members.map((s) => s.room_number).join(", "),
      totalAmount,
      totalPrepayment,
      paymentStatus: groupPaymentStatus(members),
      anyInRoom: members.some((s) =>
        isGuestInRoom(s.check_out, s.check_in ?? s.record_date, s.stay_type),
      ),
      anyBookedFuture: members.some((s) =>
        isFutureBooking(s.check_out, s.check_in ?? s.record_date),
      ),
      anyCheckoutToday: members.some(
        (s) =>
          isOpenStay(s.check_out) && isCheckoutToday(s.planned_check_out),
      ),
      allCheckedOut: members.every((s) => !isOpenStay(s.check_out)),
    };
  });
}

export function newGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `grp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
