import { toast as sonnerToast, type ExternalToast } from "sonner";

/** All CRM toasts auto-hide after this (including «Новая запись»). */
export const TOAST_DURATION_MS = 2000;

type ToastShow = (message: string, data?: ExternalToast) => string | number;

function showWithAutoDismiss(show: ToastShow, message: string, data?: ExternalToast) {
  const duration = TOAST_DURATION_MS;
  const id = show(message, { ...data, duration });
  window.setTimeout(() => {
    sonnerToast.dismiss(id);
  }, duration);
  return id;
}

/** Drop-in toast API: always dismisses after 2s (sonner can keep some sticky). */
export const toast = {
  success: (message: string, data?: ExternalToast) =>
    showWithAutoDismiss(sonnerToast.success.bind(sonnerToast), message, data),
  error: (message: string, data?: ExternalToast) =>
    showWithAutoDismiss(sonnerToast.error.bind(sonnerToast), message, data),
  info: (message: string, data?: ExternalToast) =>
    showWithAutoDismiss(sonnerToast.info.bind(sonnerToast), message, data),
  warning: (message: string, data?: ExternalToast) =>
    showWithAutoDismiss(sonnerToast.warning.bind(sonnerToast), message, data),
  message: (message: string, data?: ExternalToast) =>
    showWithAutoDismiss(sonnerToast.message.bind(sonnerToast), message, data),
  dismiss: (...args: Parameters<typeof sonnerToast.dismiss>) =>
    sonnerToast.dismiss(...args),
  promise: sonnerToast.promise.bind(sonnerToast),
};

/** @deprecated Prefer toast.error — kept for existing call sites. */
export function toastError(message: string, _duration = TOAST_DURATION_MS) {
  return toast.error(message);
}
