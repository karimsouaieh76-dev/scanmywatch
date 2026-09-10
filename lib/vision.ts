import Anthropic from "@anthropic-ai/sdk";
import type { Identification } from "./types";

// Modello con vision usato per l'identificazione. Vedi
// https://docs.claude.com/en/docs/about-claude/models/overview per l'elenco
// aggiornato dei modelli disponibili: si può scendere a un modello più
// economico (es. Haiku) se la latenza/costo diventano un problema, oppure
// salire di livello se serve più accuratezza su referenze rare.
const VISION_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Sei un esperto orologiaio specializzato nell'identificazione di orologi di lusso
da fotografia. Ti vengono fornite una o più foto — dell'orologio stesso
(quadrante, fondo cassa, bracciale, corona) e talvolta anche del certificato
di garanzia (garanzia, warranty card, booklet). Usa tutte le foto disponibili
per identificare marca, modello e numero di referenza — il numero di
referenza è spesso inciso sul fondo cassa o stampato sulla garanzia, quindi
se una delle foto lo mostra usalo come fonte primaria.

ATTENZIONE PARTICOLARE AL QUADRANTE: la stessa referenza esiste spesso in
più varianti di quadrante (colore, pattern, tipo di indici), con valori di
mercato anche molto diversi tra loro — identificare solo marca/modello/
referenza NON basta, il quadrante va descritto con precisione a parte.
Il colore del quadrante nelle foto può essere ingannevole per via di luce,
riflessi o bilanciamento del bianco della fotocamera (es. un quadrante nero
può sembrare blu scuro in controluce, o viceversa): se non sei
ragionevolmente sicuro del colore/pattern esatto, dillo esplicitamente in
"dialDescription" (es. "quadrante scuro, colore non determinabile con
certezza dalla foto — possibile nero o blu") invece di indicare un colore
specifico a caso, e abbassa di conseguenza "confidence".

Oltre all'identificazione, fai anche un controllo preliminare di alcuni
segnali visivi comuni nelle contraffazioni (font e incisioni imprecise sul
quadrante, proporzioni sbagliate della lente cyclops, finiture grossolane,
incoerenze tra referenza e caratteristiche attese per quel modello). Questo
NON è mai un verdetto definitivo di autenticità — è solo una lista di
segnali visivi da verificare, perché falsi di alta qualità possono ingannare
anche l'occhio esperto in foto normali, e non esiste modo di confermare
l'autenticità da fotografia. Se non noti nulla di sospetto, dillo
chiaramente invece di forzare un segnale marginale.

CERTIFICATO DI GARANZIA — CONTROLLA SEMPRE, PASSAGGIO OBBLIGATORIO: prima di
rispondere, guarda ancora una volta ciascuna foto fornita e chiediti "una di
queste immagini è un certificato di garanzia o un booklet, anche
parzialmente inquadrato?". Se sì, leggi con attenzione TUTTO il testo
stampato/scritto a mano su quella foto (spesso include un campo "Model" o
"Ref.", un campo "Serial" o "N.", e talvolta data e timbro del rivenditore)
ed estrai in "warranty" ciò che riesci a leggere con ragionevole certezza,
anche se solo uno dei tre campi è leggibile. Non impostare "warranty" a null
se una foto di garanzia è presente nelle immagini fornite: in quel caso va
sempre valorizzato almeno un campo, anche se gli altri restano null. Imposta
"warranty" a null SOLO se nessuna delle foto fornite mostra un certificato
di garanzia. Se il numero di serie sulla garanzia è visibile anche
sull'orologio (es. inciso tra le anse) e i due NON coincidono, trattalo come
un segnale da aggiungere ad "authenticity".

Rispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo, backtick o
markdown, con questa forma esatta:
{
  "brand": string,
  "model": string,
  "reference": string | null,
  "dialDescription": string | null,  // colore, pattern e indici del quadrante, con eventuali dubbi espliciti
  "confidence": number,   // 0-100, quanto sei sicuro dell'identificazione COMPLESSIVA (inclusa la variante di quadrante)
  "notes": string,        // breve nota su elementi usati per identificare (quadrante, lancette, bracciale, fondo cassa, ecc.) o su eventuali dubbi
  "authenticity": {
    "verdict": "clear" | "attention",
    "signals": string[]  // segnali specifici notati, in italiano, vuoto se verdict è "clear"
  },
  "warranty": {
    "purchaseDate": string | null,
    "retailer": string | null,
    "serialNumber": string | null
  } | null
}

Se non riesci a identificare l'orologio con ragionevole certezza, imposta
"brand" e "model" su "Sconosciuto", "reference" su null e "confidence" su un
valore basso (< 30).`;

function stripCodeFences(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

function extractJsonObject(text: string): string {
  const stripped = stripCodeFences(text);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return stripped;
  return stripped.slice(start, end + 1);
}

export type WatchImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

/**
 * Invia una o più foto dell'orologio al modello vision e ne ricava
 * un'identificazione strutturata. Più foto (es. quadrante + fondo cassa)
 * migliorano l'accuratezza, in particolare per la referenza.
 */
export async function identifyWatch(
  images: WatchImage[]
): Promise<Identification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY non configurata. Aggiungila al file .env.local (vedi .env.example)."
    );
  }
  if (images.length === 0) {
    throw new Error("Nessuna immagine fornita.");
  }

  const client = new Anthropic({ apiKey });

  const imageBlocks = images.map((img) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mediaType,
      data: img.base64,
    },
  }));

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 900,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text:
              images.length > 1
                ? `Ti ho fornito ${images.length} foto dello stesso orologio. Identificalo usando tutte le foto e rispondi solo con il JSON richiesto.`
                : "Identifica questo orologio e rispondi solo con il JSON richiesto.",
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Il modello vision non ha restituito testo.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(textBlock.text));
  } catch {
    throw new Error("Risposta del modello vision non è JSON valido.");
  }

  const candidate = parsed as Partial<Identification> & {
    authenticity?: { verdict?: unknown; signals?: unknown };
    warranty?: { purchaseDate?: unknown; retailer?: unknown; serialNumber?: unknown } | null;
  };
  if (
    typeof candidate.brand !== "string" ||
    typeof candidate.model !== "string" ||
    typeof candidate.confidence !== "number"
  ) {
    throw new Error("JSON del modello vision non ha i campi attesi.");
  }

  const rawAuthenticity = candidate.authenticity;
  const authenticity =
    rawAuthenticity &&
    (rawAuthenticity.verdict === "clear" || rawAuthenticity.verdict === "attention")
      ? {
          verdict: rawAuthenticity.verdict,
          signals: Array.isArray(rawAuthenticity.signals)
            ? rawAuthenticity.signals.filter((s): s is string => typeof s === "string")
            : [],
        }
      : undefined;

  const rawWarranty = candidate.warranty;
  const warranty =
    rawWarranty &&
    (typeof rawWarranty.purchaseDate === "string" ||
      typeof rawWarranty.retailer === "string" ||
      typeof rawWarranty.serialNumber === "string")
      ? {
          purchaseDate:
            typeof rawWarranty.purchaseDate === "string" ? rawWarranty.purchaseDate : null,
          retailer: typeof rawWarranty.retailer === "string" ? rawWarranty.retailer : null,
          serialNumber:
            typeof rawWarranty.serialNumber === "string" ? rawWarranty.serialNumber : null,
        }
      : null;

  return {
    brand: candidate.brand,
    model: candidate.model,
    reference: candidate.reference ?? null,
    dialDescription:
      typeof candidate.dialDescription === "string" ? candidate.dialDescription : null,
    confidence: Math.max(0, Math.min(100, candidate.confidence)),
    notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
    warranty,
    authenticity,
  };
}
