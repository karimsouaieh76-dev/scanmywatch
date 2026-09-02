import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase per Route Handler (es. /api/identify). Legge la sessione
 * dell'utente dai cookie della richiesta, così le query rispettano
 * automaticamente le policy di Row Level Security per l'utente loggato.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Chiamato da un Server Component: il middleware si occupa
            // già del refresh dei cookie, questo errore è ignorabile.
          }
        },
      },
    }
  );
}
