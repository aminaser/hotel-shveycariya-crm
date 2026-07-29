export const PAYMENT_METHOD_PRESETS = [
  { value: "cash", label: "Наличка" },
  { value: "kaspi", label: "Kaspi" },
  { value: "halyk", label: "Halyk" },
  { value: "custom", label: "Свой вариант" },
] as const;

export type PaymentMethodPreset = (typeof PAYMENT_METHOD_PRESETS)[number]["value"];

export function resolvePaymentMethod(
  preset: PaymentMethodPreset | string,
  customText: string,
): string | null {
  if (!preset) return null;
  if (preset === "custom") {
    const trimmed = customText.trim();
    return trimmed || null;
  }
  return preset;
}

export function splitPaymentMethod(value: string | null): {
  preset: PaymentMethodPreset | "custom";
  customText: string;
} {
  if (!value) return { preset: "cash", customText: "" };
  const known = PAYMENT_METHOD_PRESETS.find((p) => p.value === value && p.value !== "custom");
  if (known) return { preset: known.value, customText: "" };
  return { preset: "custom", customText: value };
}

export function formatPaymentMethod(value: string | null | undefined): string {
  if (!value) return "—";
  const preset = PAYMENT_METHOD_PRESETS.find((p) => p.value === value);
  if (preset && preset.value !== "custom") return preset.label;
  return value;
}
