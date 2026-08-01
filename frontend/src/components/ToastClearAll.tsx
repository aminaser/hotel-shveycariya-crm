import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast as sonnerToast, useSonner } from "sonner";

import { cn } from "@/lib/utils";

function dismissAllToasts() {
  const active = sonnerToast.getToasts();
  if (active.length === 0) {
    sonnerToast.dismiss();
    return;
  }
  // Dismiss by id — bare dismiss() can leave one ghost in sonner's state.
  for (const t of active) {
    sonnerToast.dismiss(t.id);
  }
}

/**
 * Clear-all above the toast stack (right side).
 * Uses sonner's own toast list so the button never sticks on a DOM ghost.
 */
export function ToastClearAll() {
  const { toasts } = useSonner();
  const [optimisticClear, setOptimisticClear] = useState(false);

  const count = optimisticClear ? 0 : toasts.length;

  useEffect(() => {
    if (toasts.length > 0) setOptimisticClear(false);
  }, [toasts.length]);

  if (count === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 flex justify-end p-3"
      style={{ zIndex: 2147483646 }}
    >
      <button
        type="button"
        onClick={() => {
          setOptimisticClear(true);
          dismissAllToasts();
        }}
        className={cn(
          "pointer-events-auto inline-flex items-center gap-2 rounded-full border border-red-200",
          "bg-white px-3 py-1.5 text-sm font-semibold text-red-700 shadow-lg",
          "transition hover:bg-red-50 hover:border-red-300 active:scale-[0.98]",
        )}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        Удалить все
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs tabular-nums text-red-800">
          {count}
        </span>
      </button>
    </div>
  );
}
