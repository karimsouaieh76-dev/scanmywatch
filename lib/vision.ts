import Anthropic from "@anthropic-ai/sdk";
import type { Identification } from "./types";

// Modello con vision usato per l'identificazione. Vedi
// https://docs.claude.com/en/docs/about-claude/models/overview per l'elenco
// aggiornato dei modelli disponibili: si può scendere a un modello più
// economico (es. Haiku) se la latenza/costo diventano un problema, oppure
// salire di livello se serve più accuratezza su referenze rare.
const VISION_MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Sei un esperto orologiaio specializzato nell'identificazione di orologi di lusso
da fotografia. Ti vengono fornite una o più foto dello stesso orologio (es.
quadrante, fondo cassa, bracciale, corona). Usa tutte le foto disponibili
per identificare marca, modello e numero di referenza — il numero di
referenza è spesso inciso sul fondo cassa, quindi se una delle foto lo
mostra usalo come fonte primaria.

Oltre all'identificazione, fai anche un controllo preliminare di alcuni
segnali visivi comuni nelle contraffazioni (font e incisioni imprecise sul
quadrante, proporzioni sbagliate della lente cyclops, finiture grossolane,
incoerenze tra referenza e caratteristiche attese per quel modello). Questo
NON è mai un verdetto definitivo di autenticità — è solo una lista di
segnali visivi da verificare, perché falsi di alta qualità possono ingannare
anche l'occhio esperto in foto normali, e non esiste modo di confermare
l'autenticità da fotografia. Se non noti nulla di sospetto, dillo
chiaramente invece di forzare un segnale marginale.

Rispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo, backtick o
markdown, con questa forma esatta:
{
  "brand": string,
  "model": string,
  "reference": string | null,
  "confidence": number,   // 0-100, quanto sei sicuro dell'identificazione
  "notes": string,        // breve nota su elementi usati per identificare (quadrante, lancette, bracciale, fondo cassa, ecc.) o su eventuali dubbi
  "authenticity": {
    "verdict": "clear" | "attention",
    "signals": string[]  // segnali specifici notati, in italiano, vuoto se verdict è "clear"
  }
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
    max_tokens: 500,
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

  return {
    brand: candidate.brand,
    model: candidate.model,
    reference: candidate.reference ?? null,
    confidence: Math.max(0, Math.min(100, candidate.confidence)),
    notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
    authenticity,
  };
}
