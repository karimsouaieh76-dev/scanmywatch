/**
 * Limiti del piano gratuito. Quando colleghiamo Stripe, un utente con
 * subscriptions.status === "active" bypassa questi limiti (vedi
 * lib/quota.ts). Cambiare questi numeri non richiede altre modifiche al
 * codice.
 */
export const FREE_MONTHLY_SCANS = 3;
export const MAX_DEVICES = 2;
