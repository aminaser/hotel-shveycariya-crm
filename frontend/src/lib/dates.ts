const ALMATY_TZ = "Asia/Almaty";
const CHECK_IN_HOUR = 13;
const CHECK_OUT_HOUR = 12;

/** YYYY-MM-DD in hotel timezone (Текели / Asia/Almaty). */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TZ }).format(new Date());
}

/** Current hour 0–23 in hotel timezone. */
export function hourLocal(): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: ALMATY_TZ,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const hour = parseInt(raw, 10);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

export function isCheckoutToday(checkOut: string | null | undefined): boolean {
  return checkOut === todayLocal();
}

/** Open stay (not checked out yet) — may still be a future booking. */
export function isOpenStay(checkOut: string | null | undefined): boolean {
  return !checkOut;
}

/** @deprecated use isOpenStay / isGuestInRoom */
export function isActiveStay(checkOut: string | null | undefined): boolean {
  return isOpenStay(checkOut);
}

/**
 * Guest is physically in the room now.
 * Future check-in → false (бронь). Check-in today → only from 13:00.
 * Planned checkout day from 12:00 → false (номер свободен под следующего гостя).
 */
export function isGuestInRoom(
  checkOut: string | null | undefined,
  checkIn?: string | null,
  stayType?: string | null,
  plannedCheckOut?: string | null,
): boolean {
  if (checkOut) return false;
  const today = todayLocal();
  if (plannedCheckOut && plannedCheckOut === today && hourLocal() >= CHECK_OUT_HOUR) {
    return false;
  }
  if (stayType === "extension") return true;
  if (!checkIn) return true;
  if (checkIn > today) return false;
  if (checkIn < today) return true;
  return hourLocal() >= CHECK_IN_HOUR;
}

/** Open stay with check-in still in the future (бронь, ещё не заселились). */
export function isFutureBooking(
  checkOut: string | null | undefined,
  checkIn?: string | null,
): boolean {
  if (checkOut) return false;
  if (!checkIn) return false;
  return checkIn > todayLocal();
}

/** Number of paid nights between check-in and check-out (min 1). */
export function nightsBetween(checkIn: string, checkOut?: string | null): number {
  if (!checkIn) return 1;
  if (!checkOut || checkOut <= checkIn) return 1;
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, diff);
}

/** Fixed package price for «Встреча выпускников» (₸ per person). */
export const ALUMNI_PRICE_PER_PERSON = 25_000;

export const ALUMNI_PACKAGE_INCLUDES =
  "Проживание в гостинице, банкет, бассейн, баня с сауной, комплексное трёхразовое питание";

export function alumniPackageAmount(peopleCount: number): string {
  const people = Math.max(1, Math.floor(peopleCount) || 1);
  return String(people * ALUMNI_PRICE_PER_PERSON);
}

export function stayAmountFromRate(
  pricePerNight: string | number | null | undefined,
  checkIn: string,
  checkOut?: string | null,
): string {
  const rate = typeof pricePerNight === "string" ? parseFloat(pricePerNight) : Number(pricePerNight);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  const nights = nightsBetween(checkIn, checkOut);
  return String(Math.round(rate * nights));
}
