import { formatMoney } from "@/lib/format";

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

export function dishLineTotal(item: OrderedDish): number {
  return item.price * item.quantity;
}

export function dishesTotal(items: OrderedDish[]): number {
  return items.reduce((sum, item) => sum + dishLineTotal(item), 0);
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
      quantity: item.quantity,
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
            quantity: item.quantity,
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

export function formatDishesPreview(raw: string | null | undefined): string {
  if (!raw?.trim()) return "—";
  const { items, note, legacy } = parseDishes(raw);
  if (legacy) return note;
  if (items.length === 0) return note || "—";

  const lines = items.map(
    (item) => `${dishDisplayName(item)} × ${item.quantity} — ${formatMoney(dishLineTotal(item))}`,
  );
  const total = dishesTotal(items);
  lines.push(`Итого: ${formatMoney(total)}`);
  if (note) lines.push(note);
  return lines.join("\n");
}
