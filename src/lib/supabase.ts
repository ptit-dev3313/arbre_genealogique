import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

// Only public browser credentials belong in Vite's compiled environment.
export const cloudConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)
  && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);

export const authRedirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;

// Keep local editing available without a configured backend; block all network access.
export const supabase = createClient<Database>(
  cloudConfigured ? url : "http://127.0.0.1:1",
  cloudConfigured ? key : "offline",
  {
    auth: {
      persistSession: cloudConfigured,
      autoRefreshToken: cloudConfigured,
      detectSessionInUrl: cloudConfigured,
      storageKey: "arbre.sb.auth",
      flowType: "pkce",
    },
    ...(!cloudConfigured ? {
      global: { fetch: async () => { throw new Error("La synchronisation en ligne est indisponible."); } },
    } : {}),
  },
);
