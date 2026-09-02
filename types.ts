// Tipi condivisi tra il modulo di identificazione, il market-data provider
// e il valuation engine.

export type AuthenticityCheck = {
  /** "clear": nessun segnale sospetto rilevato — "attention": uno o più segnali da verificare */
  verdict: "clear" | "attention";
  /** Elenco di segnali specifici notati (vuoto se verdict è "clear") */
  signals: string[];
};

export type Identification = {
  brand: string;
  model: string;
  reference: string | null;
  /** 0-100, confidenza del modello vision sull'identificazione */
  confidence: number;
  /** Dettagli utili per QA / debug, non mostrati necessariamente in UI */
  notes?: string;
  /** Controllo preliminare di autenticità — MAI un verdetto assoluto, solo segnali da verificare */
  authenticity?: AuthenticityCheck;
};

export type MarketComp = {
  source: string;
  price: number;
  currency: "EUR";
  condition?: string;
  /** URL della fonte, quando disponibile (es. da ricerca web) */
  url?: string;
};

export type MarketData = {
  reference: string;
  comps: MarketComp[];
  /** true se i comps sono reali (provider o web search), false se dal mock */
  live: boolean;
  /**
   * Come è stato ottenuto il dato:
   * - "provider": API dedicata configurata (es. WatchCharts) — più affidabile
   * - "web_search": stima ricavata da Claude tramite ricerca web — reale ma
   *   non verificata/strutturata come un provider dedicato
   * - "mock": dato demo, non rappresenta un prezzo reale
   */
  method: "provider" | "web_search" | "mock";
};

export type Valuation = {
  value: number;
  min: number;
  max: number;
  buyTarget: number;
  sellTarget: number;
  sampleSize: number;
};

export type ScanResult = {
  identification: Identification;
  market: MarketData;
  valuation: Valuation;
};
