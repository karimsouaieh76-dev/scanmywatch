import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase per componenti client ("use client"). Usa la publishable
 * key (sicura da esporre nel browser, dato che ogni tabella ha Row Level
 * Security attiva — ogni utente vede/modifica solo i propri dati).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
