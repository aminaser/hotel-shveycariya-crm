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
      relaunchApp: () => Promise<void>;
      checkForUpdates: () => Promise<{
        ok: boolean;
        version?: string | null;
        reason?: string;
      }>;
    };
  }
}
