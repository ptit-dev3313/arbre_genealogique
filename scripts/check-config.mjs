import { loadEnv } from "vite";

const env = loadEnv("production", process.cwd(), "VITE_");
const url = env.VITE_SUPABASE_URL?.trim() ?? "";
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)
    || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
  console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to public Supabase credentials. Secret and service-role keys are forbidden.");
  process.exit(1);
}
console.log("Public Supabase configuration validated.");
