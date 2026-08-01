/// <reference types="vite/client" />

export {};

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getAppPath: () => Promise<string>;
      relaunchApp: () => Promise<{ ok: boolean } | void>;
      checkForUpdates: () => Promise<{
        ok: boolean;
        current?: string;
        version?: string | null;
        upToDate?: boolean;
        reason?: string;
      }>;
    };
  }
}
