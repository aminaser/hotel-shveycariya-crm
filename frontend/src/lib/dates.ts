const ALMATY_TZ = "Asia/Almaty";

/** YYYY-MM-DD in hotel timezone (Текели / Asia/Almaty). */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ALMATY_TZ }).format(new Date());
}

export function isCheckoutToday(checkOut: string | null | undefined): boolean {
  return checkOut === todayLocal();
}

export function isActiveStay(checkOut: string | null | undefined): boolean {
  return !checkOut;
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
