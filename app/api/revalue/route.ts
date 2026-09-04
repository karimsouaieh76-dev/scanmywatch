import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { computeValuation } from "@/lib/valuation";
import { createClient } from "@/lib/supabase/server";
import type { Identification } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Ricalcola solo valore di mercato + autenticità NON toccata, a partire da
 * dati di identificazione corretti manualmente dall'utente (es. quando
 * l'AI ha sbagliato marca/modello/referenza). Non richiama il modello
 * vision: più veloce, più economico, e non consuma una scansione dal
 * limite mensile — è una correzione, non una nuova analisi.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Devi effettuare l'accesso." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
  }

  const { brand, model, reference } = body as {
    brand?: string;
    model?: string;
    reference?: string | null;
  };

  if (!brand || !model) {
    return NextResponse.json(
      { error: "Marca e modello sono obbligatori." },
      { status: 400 }
    );
  }

  try {
    const identification: Identification = {
      brand,
      model,
      reference: reference || null,
      confidence: 100, // Correzione manuale: consideriamo il dato affidabile al 100%.
      notes: "Dati corretti manualmente dall'utente.",
    };

    const market = await getMarketData(identification);
    const valuation = computeValuation(market);

    return NextResponse.json({ identification, market, valuation });
  } catch (err) {
    console.error("[/api/revalue] errore:", err);
    const message = err instanceof Error ? err.message : "Errore interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
