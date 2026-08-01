import { toast as sonnerToast, type ExternalToast } from "sonner";

/** Sticky until the user clicks the close (X) button. */
export const TOAST_DURATION_MS = Number.POSITIVE_INFINITY;

type ToastShow = (message: string, data?: ExternalToast) => string | number;

function withDefaults(data?: ExternalToast): ExternalToast {
  return {
    ...data,
    duration: Number.POSITIVE_INFINITY,
    closeButton: true,
  };
}

function showSticky(show: ToastShow, message: string, data?: ExternalToast) {
  return show(message, withDefaults(data));
}

/** Drop-in toast API: stays until dismissed via the X button. */
export const toast = {
  success: (message: string, data?: ExternalToast) =>
    showSticky(sonnerToast.success.bind(sonnerToast), message, data),
  error: (message: string, data?: ExternalToast) =>
    showSticky(sonnerToast.error.bind(sonnerToast), message, data),
  info: (message: string, data?: ExternalToast) =>
    showSticky(sonnerToast.info.bind(sonnerToast), message, data),
  warning: (message: string, data?: ExternalToast) =>
    showSticky(sonnerToast.warning.bind(sonnerToast), message, data),
  message: (message: string, data?: ExternalToast) =>
    showSticky(sonnerToast.message.bind(sonnerToast), message, data),
  dismiss: (...args: Parameters<typeof sonnerToast.dismiss>) =>
    sonnerToast.dismiss(...args),
  dismissAll: () => {
    const active = sonnerToast.getToasts();
    for (const t of active) {
      sonnerToast.dismiss(t.id);
    }
  },
  promise: sonnerToast.promise.bind(sonnerToast),
};

/** @deprecated Prefer toast.error — kept for existing call sites. */
export function toastError(message: string, _duration = TOAST_DURATION_MS) {
  return toast.error(message);
}
