const ALMATY_TZ = "Asia/Almaty";
const CHECK_OUT_HOUR = 12;
const CHECK_IN_HOUR = 13;

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

/** Planned checkout date has passed (or today from 12:00) — room free for turnover. */
export function isReleasedByCheckout(
  plannedCheckOut: string | null | undefined,
): boolean {
  if (!plannedCheckOut) return false;
  const today = todayLocal();
  if (plannedCheckOut < today) return true;
  return plannedCheckOut === today && hourLocal() >= CHECK_OUT_HOUR;
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
 * - formal checkout / released by planned checkout → false
 * - extension → true until released
 * - booking/alumni → checked_in_at required; on check-in day only after 13:00
 */
export function isGuestInRoom(
  checkOut: string | null | undefined,
  checkIn?: string | null,
  stayType?: string | null,
  plannedCheckOut?: string | null,
  options?: { checkedInAt?: string | null; inRoom?: boolean | null },
): boolean {
  if (checkOut) return false;
  if (isReleasedByCheckout(plannedCheckOut)) return false;
  if (stayType === "extension") return true;
  if (!options?.checkedInAt) return false;

  const today = todayLocal();
  const ci = checkIn || null;
  if (ci && ci > today) return false;
  if (ci && ci === today && hourLocal() < CHECK_IN_HOUR) return false;
  return true;
}

/** Open stay awaiting arrival / before 13:00 on check-in day. */
export function isFutureBooking(
  checkOut: string | null | undefined,
  checkIn?: string | null,
  options?: {
    checkedInAt?: string | null;
    inRoom?: boolean | null;
    plannedCheckOut?: string | null;
    stayType?: string | null;
  },
): boolean {
  if (checkOut) return false;
  if (isReleasedByCheckout(options?.plannedCheckOut)) return false;
  if (options?.stayType === "extension") return false;
  if (
    isGuestInRoom(checkOut, checkIn, options?.stayType, options?.plannedCheckOut, {
      checkedInAt: options?.checkedInAt,
      inRoom: options?.inRoom,
    })
  ) {
    return false;
  }
  return true;
}

/** Planned or formal departure date (YYYY-MM-DD). */
export function stayDepartureDate(
  checkOut?: string | null,
  plannedCheckOut?: string | null,
): string | null {
  return checkOut || plannedCheckOut || null;
}

/**
 * Free-room badge for journal:
 * - departure day (from 12:00 or after formal checkout) → free_from_noon («Свободен с 12:00»)
 * - after departure day → free («Свободен»)
 * - otherwise null (still occupied / before checkout day)
 */
export function freeRoomBadgeKind(
  checkOut?: string | null,
  plannedCheckOut?: string | null,
): "free_from_noon" | "free" | null {
  const dep = stayDepartureDate(checkOut, plannedCheckOut);
  if (!dep) return null;
  const today = todayLocal();
  if (dep > today) return null;
  if (dep === today) {
    if (checkOut) return "free_from_noon";
    if (hourLocal() >= CHECK_OUT_HOUR) return "free_from_noon";
    return null;
  }
  return "free";
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

/** Default package price for «Встреча выпускников» (₸ per person). */
export const ALUMNI_PRICE_PER_PERSON = 25_000;

export const ALUMNI_PACKAGE_INCLUDES =
  "Проживание в гостинице, банкет, бассейн, баня с сауной, комплексное трёхразовое питание";

export function alumniPackageAmount(
  peopleCount: number,
  pricePerPerson: number = ALUMNI_PRICE_PER_PERSON,
): string {
  const people = Math.max(1, Math.floor(peopleCount) || 1);
  const rate = Number.isFinite(pricePerPerson) && pricePerPerson >= 0
    ? pricePerPerson
    : ALUMNI_PRICE_PER_PERSON;
  return String(people * rate);
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
