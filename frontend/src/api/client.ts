import { useAuthStore } from "@/stores/auth";

function resolveApiBase(): string {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  // Packaged Electron loads index.html via file:// — relative /api won't reach uvicorn.
  if (typeof window !== "undefined") {
    if (window.electronAPI?.isElectron || window.location.protocol === "file:") {
      return "http://127.0.0.1:8000/api/v1";
    }
  }
  return "/api/v1";
}

const API_BASE = resolveApiBase();

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function messageFromErrorBody(data: {
  detail?: string | Array<{ msg?: string }>;
}): string {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail) && data.detail.length > 0) {
    const joined = data.detail
      .map((item) => item.msg)
      .filter(Boolean)
      .join("; ");
    if (joined) return joined;
  }
  return "Ошибка запроса";
}

// On expired/invalid token, drop the session so ProtectedRoute redirects to login
// instead of showing "Недействительный токен" errors on every action.
function handleUnauthorized(path: string, status: number): void {
  if (status !== 401 || path.startsWith("/auth")) return;
  const { token, logout } = useAuthStore.getState();
  if (token) logout();
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "Ошибка запроса";
    try {
      message = messageFromErrorBody((await response.json()) as Parameters<typeof messageFromErrorBody>[0]);
    } catch {
      // ignore
    }
    handleUnauthorized(path, response.status);
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function apiDownload(
  path: string,
  options: RequestInit = {},
  filename = "download",
): Promise<void> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "Ошибка запроса";
    try {
      message = messageFromErrorBody((await response.json()) as Parameters<typeof messageFromErrorBody>[0]);
    } catch {
      // ignore
    }
    handleUnauthorized(path, response.status);
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
