import { formatMoney } from "@/lib/format";

/** Service charge applied to banquet orders only (not takeaway). */
export const BANQUET_SERVICE_CHARGE_RATE = 0.1;
export const BANQUET_SERVICE_CHARGE_PERCENT = 10;

/** Portion step for menu qty: 0.5, 1, 1.5, 2… */
export const QTY_STEP = 0.5;
export const QTY_MIN = 0.5;

export interface OrderedDish {
  key: string;
  name: string;
  price: number;
  quantity: number;
  size?: string;
}

interface DishesPayloadV1 {
  v: 1;
  items: OrderedDish[];
  note?: string;
}

/** Snap quantity to 0.5 steps (0.5, 1, 1.5…). */
export function normalizeQty(value: number, min: number = QTY_MIN): number {
  if (!Number.isFinite(value) || value < min - 1e-9) return min;
  const stepped = Math.round(value / QTY_STEP) * QTY_STEP;
  return Math.max(min, Math.round(stepped * 10) / 10);
}

export function formatQty(value: number): string {
  const n = Math.round(value * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function dishLineTotal(item: OrderedDish): number {
  return Math.round(item.price * item.quantity);
}

export function dishesTotal(items: OrderedDish[]): number {
  return items.reduce((sum, item) => sum + dishLineTotal(item), 0);
}

export function serviceChargeAmount(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return Math.round(subtotal * BANQUET_SERVICE_CHARGE_RATE);
}

export function dishesTotalWithService(items: OrderedDish[]): {
  subtotal: number;
  service: number;
  total: number;
} {
  const subtotal = dishesTotal(items);
  const service = serviceChargeAmount(subtotal);
  return { subtotal, service, total: subtotal + service };
}

export function dishDisplayName(item: Pick<OrderedDish, "name" | "size">): string {
  return item.size ? `${item.name} (${item.size})` : item.name;
}

export function serializeDishes(items: OrderedDish[], note = ""): string {
  if (items.length === 0 && !note.trim()) return "";
  const payload: DishesPayloadV1 = {
    v: 1,
    items: items.map((item) => ({
      key: item.key,
      name: item.name,
      price: item.price,
      quantity: normalizeQty(item.quantity),
      ...(item.size ? { size: item.size } : {}),
    })),
  };
  if (note.trim()) payload.note = note.trim();
  return JSON.stringify(payload);
}

export function parseDishes(raw: string | null | undefined): {
  items: OrderedDish[];
  note: string;
  legacy: boolean;
} {
  if (!raw?.trim()) return { items: [], note: "", legacy: false };
  try {
    const data = JSON.parse(raw) as DishesPayloadV1;
    if (data?.v === 1 && Array.isArray(data.items)) {
      return {
        items: data.items
          .filter(
            (item) =>
              item &&
              typeof item.name === "string" &&
              typeof item.price === "number" &&
              typeof item.quantity === "number" &&
              item.quantity > 0,
          )
          .map((item) => ({
            key: item.key || (item.size ? `${item.name}::${item.size}` : item.name),
            name: item.name,
            price: item.price,
            quantity: normalizeQty(item.quantity),
            ...(item.size ? { size: item.size } : {}),
          })),
        note: typeof data.note === "string" ? data.note : "",
        legacy: false,
      };
    }
  } catch {
    // free-text legacy
  }
  return { items: [], note: raw.trim(), legacy: true };
}

export function formatDishesPreview(
  raw: string | null | undefined,
  options?: { serviceCharge?: boolean },
): string {
  if (!raw?.trim()) return "—";
  const { items, note, legacy } = parseDishes(raw);
  if (legacy) return note;
  if (items.length === 0) return note || "—";

  const lines = items.map(
    (item) =>
      `${dishDisplayName(item)} × ${formatQty(item.quantity)} — ${formatMoney(dishLineTotal(item))}`,
  );
  const { subtotal, service, total } = dishesTotalWithService(items);
  if (options?.serviceCharge && service > 0) {
    lines.push(`Блюда: ${formatMoney(subtotal)}`);
    lines.push(`Обслуживание ${BANQUET_SERVICE_CHARGE_PERCENT}%: ${formatMoney(service)}`);
    lines.push(`Итого: ${formatMoney(total)}`);
  } else {
    lines.push(`Итого: ${formatMoney(subtotal)}`);
  }
  if (note) lines.push(note);
  return lines.join("\n");
}
