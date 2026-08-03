import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";

/** Balance due after a partial prepayment (total − prepaid). */
export function partialRemainder(totalAmount: number, prepayment: string | number): number {
  const prepaid =
    typeof prepayment === "string" ? parseFloat(prepayment) || 0 : prepayment || 0;
  return Math.max(0, (totalAmount || 0) - prepaid);
}

interface PartialPaymentRemainderProps {
  totalAmount: number;
  prepayment: string | number;
  /** When false, hide even if amounts are set. Default: show when prepaid > 0 and total > 0. */
  visible?: boolean;
}

/**
 * Shown after partial status + prepayment: «Сумма доплаты» and a green suggested amount.
 */
export function PartialPaymentRemainder({
  totalAmount,
  prepayment,
  visible,
}: PartialPaymentRemainderProps) {
  const prepaid =
    typeof prepayment === "string" ? parseFloat(prepayment) || 0 : prepayment || 0;
  const show = visible ?? (totalAmount > 0 && prepaid > 0);
  if (!show || prepaid <= 0) return null;

  const remainder = partialRemainder(totalAmount, prepaid);

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-foreground">Сумма доплаты</Label>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(remainder)}</span>
      </div>
      <p className="text-xs text-emerald-700">
        Предлагаемая сумма доплаты: {formatMoney(remainder)}
      </p>
    </div>
  );
}

/** Prefer event/activity date for the payment date when entering a partial payment. */
export function paymentDateForEvent(
  eventDate: string | null | undefined,
  fallback = "",
): string {
  const trimmed = (eventDate || "").trim();
  if (trimmed) return trimmed;
  return fallback;
}
