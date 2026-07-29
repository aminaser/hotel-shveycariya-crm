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
  PAYMENT_METHOD_PRESETS,
  type PaymentMethodPreset,
} from "@/lib/payment-method";

interface PaymentMethodSelectProps {
  preset: PaymentMethodPreset | string;
  customText: string;
  onPresetChange: (value: PaymentMethodPreset | string) => void;
  onCustomTextChange: (value: string) => void;
}

export function PaymentMethodSelect({
  preset,
  customText,
  onPresetChange,
  onCustomTextChange,
}: PaymentMethodSelectProps) {
  return (
    <div className="space-y-2">
      <Label>Способ оплаты</Label>
      <Select value={preset} onValueChange={onPresetChange}>
        <SelectTrigger>
          <SelectValue placeholder="Выберите способ" />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_METHOD_PRESETS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" && (
        <Input
          placeholder="Например: перевод на карту, QR..."
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
        />
      )}
    </div>
  );
}
