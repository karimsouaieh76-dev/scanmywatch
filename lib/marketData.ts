import type { Identification, MarketComp, MarketData } from "./types";
import { searchMarketComps } from "./marketSearch";

// ---------------------------------------------------------------------------
// Provider di dati di mercato, in ordine di priorità:
//
//  1. Provider dedicato (es. WatchCharts) — se configurato via
//     MARKET_DATA_API_URL / MARKET_DATA_API_KEY. Il più affidabile, ma a
//     pagamento e con vincoli di licenza per l'uso su prodotti pubblici.
//  2. Ricerca web con Claude (lib/marketSearch.ts) — nessun abbonamento
//     dedicato richiesto, usa la stessa ANTHROPIC_API_KEY già configurata.
//     Dato reale ma meno strutturato/verificato di un provider dedicato.
//  3. Fallback mock — solo per non lasciare l'app vuota se anche la ricerca
//     web fallisce. Chiaramente marcato con method="mock".
// ---------------------------------------------------------------------------

async function fetchFromConfiguredProvider(
  reference: string
): Promise<MarketComp[] | null> {
  const url = process.env.MARKET_DATA_API_URL;
  const key = process.env.MARKET_DATA_API_KEY;
  if (!url || !key) return null;

  const res = await fetch(`${url}?reference=${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${key}` },
    // I dati di prezzo cambiano nel tempo: evitare cache troppo aggressive.
    next: { revalidate: 60 * 60 },
  });

  if (!res.ok) {
    throw new Error(`Market data provider ha risposto ${res.status}`);
  }

  const data = (await res.json()) as { comps?: MarketComp[] };
  return data.comps ?? [];
}

/**
 * Fallback deterministico usato solo quando né il provider dedicato né la
 * ricerca web restituiscono dati. NON rappresenta un prezzo reale.
 */
function mockComps(reference: string): MarketComp[] {
  let seed = 0;
  for (const char of reference) seed = (seed * 31 + char.charCodeAt(0)) % 100000;
  const base = 3000 + (seed % 15000);

  return [
    { source: "Mock — annuncio A", price: Math.round(base * 0.95), currency: "EUR", condition: "Ottime condizioni" },
    { source: "Mock — annuncio B", price: Math.round(base * 1.0), currency: "EUR", condition: "Come nuovo" },
    { source: "Mock — annuncio C", price: Math.round(base * 1.08), currency: "EUR", condition: "Full set" },
  ];
}

export async function getMarketData(
  identification: Identification
): Promise<MarketData> {
  const reference = identification.reference;
  if (!reference) {
    return { reference: "N/D", comps: [], live: false, method: "mock" };
  }

  try {
    const providerComps = await fetchFromConfiguredProvider(reference);
    if (providerComps && providerComps.length > 0) {
      return { reference, comps: providerComps, live: true, method: "provider" };
    }
  } catch (err) {
    console.error("[marketData] provider esterno fallito:", err);
  }

  try {
    const webComps = await searchMarketComps(
      identification.brand,
      identification.model,
      reference,
      identification.dialDescription
    );
    if (webComps && webComps.length > 0) {
      return { reference, comps: webComps, live: true, method: "web_search" };
    }
  } catch (err) {
    console.error("[marketData] ricerca web fallita:", err);
  }

  return { reference, comps: mockComps(reference), live: false, method: "mock" };
}
