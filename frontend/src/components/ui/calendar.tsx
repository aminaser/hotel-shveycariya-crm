import { ru } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CSSProperties } from "react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import "react-day-picker/style.css";

import { cn } from "@/lib/utils";

export function Calendar({ className, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={ru}
      showOutsideDays
      className={cn("rdp-crm", className)}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
      }}
      styles={{
        root: {
          "--rdp-accent-color": "#1e3a5f",
          "--rdp-accent-background-color": "#e8eef5",
          "--rdp-day-height": "2.25rem",
          "--rdp-day-width": "2.25rem",
          fontSize: "0.875rem",
        } as CSSProperties,
      }}
      {...props}
    />
  );
}
