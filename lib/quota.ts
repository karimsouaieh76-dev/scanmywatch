import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_MONTHLY_SCANS } from "./limits";

export type QuotaStatus = {
  allowed: boolean;
  remaining: number | null; // null = illimitato (abbonamento attivo)
  isSubscribed: boolean;
};

function startOfCurrentMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Controlla se l'utente può fare un'altra scansione. Un abbonamento attivo
 * (status === "active" o "trialing") rende le scansioni illimitate;
 * altrimenti si conta quante ne ha fatte questo mese contro il limite
 * gratuito.
 */
export async function checkQuota(
  supabase: SupabaseClient,
  userId: string
): Promise<QuotaStatus> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  const isSubscribed =
    subscription?.status === "active" || subscription?.status === "trialing";

  if (isSubscribed) {
    return { allowed: true, remaining: null, isSubscribed: true };
  }

  const { count } = await supabase
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfCurrentMonthISO());

  const used = count ?? 0;
  const remaining = Math.max(0, FREE_MONTHLY_SCANS - used);

  return { allowed: remaining > 0, remaining, isSubscribed: false };
}
