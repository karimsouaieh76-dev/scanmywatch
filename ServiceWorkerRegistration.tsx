"use client";

import { useEffect } from "react";

/**
 * Registra il service worker al caricamento della pagina. Necessario per
 * abilitare il prompt automatico di installazione ("Aggiungi a schermata
 * Home") su Chrome/Android — su iOS Safari l'installazione resta manuale
 * mediante "Condividi → Aggiungi a Home" indipendentemente dal service
 * worker, ma la registrazione non causa alcun problema anche lì.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Registrazione service worker fallita:", err);
    });
  }, []);

  return null;
}
