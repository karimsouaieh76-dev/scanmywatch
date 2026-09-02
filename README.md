# LUXSCAN AI — MVP

## Avvio
Richiede Node.js 20.9+.

```bash
npm install
cp .env.example .env.local   # poi valorizza ANTHROPIC_API_KEY
npm run dev
```

Apri http://localhost:3000

## Stato
Pipeline end-to-end funzionante:

1. **Identificazione (vision)** — `POST /api/identify` invia la foto al modello
   vision di Claude (`lib/vision.ts`) e ottiene marca, modello, referenza e
   confidence.
2. **Market data** — `lib/marketData.ts` cerca comparabili di prezzo per la
   referenza identificata, con tre livelli in cascata:
   1. Provider dedicato (`MARKET_DATA_API_URL`/`MARKET_DATA_API_KEY`), se configurato
   2. Ricerca web tramite Claude (`lib/marketSearch.ts`) — usa la stessa
      `ANTHROPIC_API_KEY`, nessun abbonamento extra richiesto, costo ~1
      centesimo a scansione (web search a $10/1000 ricerche)
   3. Fallback mock, solo se anche la ricerca web non trova nulla

   Il campo `market.method` (`"provider" | "web_search" | "mock"`) indica
   quale livello ha prodotto il risultato, e la UI lo segnala di conseguenza.
3. **Valuation engine** — `lib/valuation.ts` calcola valore stimato (mediana),
   range min/max e target di acquisto/vendita a partire dai comparabili.

La UI (`components/Scanner.tsx`) chiama `/api/identify` con la foto reale,
mostra lo stato di caricamento/errore e il risultato, incluso un avviso
quando i dati di mercato sono demo e non reali.

## Configurazione
Vedi `.env.example`:
- `ANTHROPIC_API_KEY` — **obbligatoria**, per l'identificazione via vision.
- `MARKET_DATA_API_URL` / `MARKET_DATA_API_KEY` — opzionali, per collegare un
  provider di dati di mercato reale.

## Prossimi passi
- Se il volume cresce, valutare un provider dedicato (es. WatchCharts) per
  dati più strutturati e verificati — richiede abbonamento e, per mostrare
  i dati agli utenti finali, una licenza Distribution/Resale (non inclusa
  nel piano base). La ricerca web resta comunque disponibile come fallback.
- Caching dei risultati di identificazione/market-data per referenza, per
  ridurre costi e latenza su referenze già viste.
- Persistenza degli scan (storico utente) — richiede DB + autenticazione,
  non ancora presenti nell'MVP.
- Gestione più granulare degli errori vision (es. immagine non di un
  orologio, più orologi nella stessa foto).
- Test automatici su `lib/valuation.ts` e `lib/marketData.ts` (logica pura,
  facilmente testabile senza mock di rete complessi).

## Struttura
- `app/` — Next.js App Router
  - `api/identify/route.ts` — orchestrazione vision → market data → valuation
- `components/Scanner.tsx` — scanner UI, ora collegata all'API reale
- `lib/` — moduli di dominio (vision, market data, valuation, tipi condivisi)
- `app/globals.css` — design system
