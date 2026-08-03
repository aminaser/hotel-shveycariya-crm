import { toast as sonnerToast, type ExternalToast } from "sonner";

/** Auto-dismiss after 2 seconds for every toast. */
export const TOAST_DURATION_MS = 2000;

type ToastShow = (message: string, data?: ExternalToast) => string | number;

function withDefaults(data?: ExternalToast): ExternalToast {
  return {
    closeButton: true,
    ...data,
    duration: data?.duration ?? TOAST_DURATION_MS,
  };
}

function showToast(show: ToastShow, message: string, data?: ExternalToast) {
  return show(message, withDefaults(data));
}

/** Drop-in toast API: all popups auto-hide after 2 seconds. */
export const toast = {
  success: (message: string, data?: ExternalToast) =>
    showToast(sonnerToast.success.bind(sonnerToast), message, data),
  error: (message: string, data?: ExternalToast) =>
    showToast(sonnerToast.error.bind(sonnerToast), message, data),
  info: (message: string, data?: ExternalToast) =>
    showToast(sonnerToast.info.bind(sonnerToast), message, data),
  warning: (message: string, data?: ExternalToast) =>
    showToast(sonnerToast.warning.bind(sonnerToast), message, data),
  message: (message: string, data?: ExternalToast) =>
    showToast(sonnerToast.message.bind(sonnerToast), message, data),
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
