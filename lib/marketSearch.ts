import Anthropic from "@anthropic-ai/sdk";
import type { MarketComp } from "./types";

// ---------------------------------------------------------------------------
// Stima del valore di mercato tramite ricerca web fatta da Claude.
//
// Non è un provider di dati strutturati come WatchCharts: Claude cerca sul
// web annunci/vendite recenti per la referenza indicata e ne ricava una
// stima ragionata, con fonti citate. È un dato reale (non inventato), ma
// meno affidabile di un database di transazioni verificate — va comunicato
// come tale in UI (vedi campo "method" in MarketData).
//
// Costo: la web search di Claude è a consumo (circa $10 ogni 1000 ricerche),
// quindi ogni scansione costa qualche centesimo — adatto per una fase beta,
// non richiede abbonamenti dedicati.
// ---------------------------------------------------------------------------

const SEARCH_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Sei un analista di mercato per orologi di lusso di seconda mano.
Ti viene fornita l'identificazione di un orologio (marca, modello, referenza).
Cerca sul web annunci di vendita, aste concluse o listing recenti per quella
referenza specifica e stima il valore di mercato attuale in EURO.

Regole:
- Usa solo prezzi che trovi realmente nelle ricerche, non inventare numeri.
- Se trovi prezzi in altre valute, convertili in EUR con un cambio approssimativo.
- Riporta al massimo 5 comparabili, con la fonte (nome del sito) e il prezzo.
- Non riportare mai testo copiato letteralmente dagli annunci: solo prezzo,
  fonte, e se disponibile una brevissima condizione (es. "usato", "full set").
- Se non trovi dati sufficienti per questa referenza, restituisci un array
  "comps" vuoto piuttosto che stimare a caso.

Rispondi con questo JSON e NIENT'ALTRO: nessuna frase introduttiva, nessun
commento finale, nessun backtick o markdown. La tua risposta deve iniziare
con "{" e finire con "}":
{
  "comps": [
    { "source": string, "price": number, "condition": string | null, "url": string | null }
  ]
}`;

function stripCodeFences(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

/**
 * Estrae il primo blocco JSON valido da un testo, anche se il modello ha
 * aggiunto frasi prima/dopo nonostante le istruzioni di rispondere solo
 * con JSON. Cerca la prima "{" e l'ultima "}" e prova a fare il parse di
 * quel sottoinsieme.
 */
function extractJsonObject(text: string): string {
  const stripped = stripCodeFences(text);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return stripped;
  return stripped.slice(start, end + 1);
}

export async function searchMarketComps(
  brand: string,
  model: string,
  reference: string,
  dialDescription?: string | null
): Promise<MarketComp[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const dialNote = dialDescription
    ? ` Quadrante: ${dialDescription}. Se trovi comparabili che specificano questo quadrante, danno una stima più precisa — ma includi comunque comparabili della stessa referenza anche se l'annuncio non specifica il colore del quadrante, piuttosto che restituire un array vuoto.`
    : "";

  try {
    const response = await client.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
      ],
      messages: [
        {
          role: "user",
          content: `Orologio: ${brand} ${model}, referenza ${reference}.${dialNote} Cerca prezzi di mercato recenti e rispondi con il JSON richiesto.`,
        },
      ],
    });

    // L'ultimo blocco di testo contiene la risposta finale del modello dopo
    // aver eventualmente eseguito le ricerche web (tool server-side).
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    );
    const lastText = textBlocks[textBlocks.length - 1];
    if (!lastText || lastText.type !== "text") return null;

    const parsed = JSON.parse(extractJsonObject(lastText.text)) as {
      comps?: Array<{
        source: string;
        price: number;
        condition?: string | null;
        url?: string | null;
      }>;
    };

    if (!parsed.comps || parsed.comps.length === 0) {
      console.error(
        `[marketSearch] nessun comparabile trovato per ${brand} ${model} ref. ${reference}`
      );
      return null;
    }

    return parsed.comps
      .filter((c) => typeof c.price === "number" && c.price > 0)
      .map((c) => ({
        source: c.source || "Ricerca web",
        price: Math.round(c.price),
        currency: "EUR" as const,
        condition: c.condition ?? undefined,
        url: c.url ?? undefined,
      }));
  } catch (err) {
    console.error("[marketSearch] ricerca web fallita:", err);
    return null;
  }
}
