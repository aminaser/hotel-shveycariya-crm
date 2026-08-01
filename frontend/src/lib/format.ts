import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function formatDate(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "dd.MM.yyyy", { locale: ru });
}

export function formatMoney(value: number | string): string {
  const amount = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const stayTypeLabel: Record<string, string> = {
  booking: "Бронь",
  extension: "Продление",
  alumni: "Встреча выпускников",
};

export const paymentStatusLabel: Record<string, string> = {
  paid: "Оплачено",
  partial: "Частично",
  unpaid: "Не оплачено",
};

export const roomStatusLabel: Record<string, string> = {
  free: "Свободно / Убрано",
  occupied: "В номере",
  cleaning: "Свободно / Требуется уборка",
  maintenance: "Ремонт",
  booked: "Заселение в 13:00",
};

export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
