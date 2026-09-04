import { NextRequest, NextResponse } from "next/server";
import { identifyWatch, type WatchImage } from "@/lib/vision";
import { getMarketData } from "@/lib/marketData";
import { computeValuation } from "@/lib/valuation";
import { createClient } from "@/lib/supabase/server";
import { checkQuota } from "@/lib/quota";
import type { ScanResult } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per immagine
const MAX_IMAGES = 4;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Devi effettuare l'accesso per analizzare un orologio." },
      { status: 401 }
    );
  }

  const quota = await checkQuota(supabase, user.id);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error:
          "Hai esaurito le scansioni gratuite di questo mese. L'abbonamento illimitato sarà disponibile a breve.",
      },
      { status: 402 }
    );
  }

  const formData = await req.formData();
  // Accetta sia il campo singolo "photo" (retrocompatibilità) sia più campi
  // "photos" per l'upload multiplo.
  const files = [
    ...formData.getAll("photos"),
    ...formData.getAll("photo"),
  ].filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "Nessuna foto ricevuta nel form-data." },
      { status: 400 }
    );
  }

  if (files.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Troppe foto: massimo ${MAX_IMAGES}.` },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Formato immagine non supportato: ${file.type}` },
        { status: 415 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Una delle immagini è troppo grande (max 8MB ciascuna)." },
        { status: 413 }
      );
    }
  }

  try {
    const images: WatchImage[] = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return {
          base64: buffer.toString("base64"),
          mediaType: file.type as WatchImage["mediaType"],
        };
      })
    );

    const identification = await identifyWatch(images);
    const market = await getMarketData(identification);
    const valuation = computeValuation(market);

    const result: ScanResult = { identification, market, valuation };

    // Salva nello storico — non blocca la risposta se fallisce.
    const { error: insertError } = await supabase.from("scans").insert({
      user_id: user.id,
      brand: identification.brand,
      model: identification.model,
      reference: identification.reference,
      confidence: identification.confidence,
      value_estimate: valuation.sampleSize > 0 ? valuation.value : null,
      market_method: market.method,
      result,
    });
    if (insertError) {
      console.error("[/api/identify] salvataggio scansione fallito:", insertError);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/identify] errore:", err);
    const message = err instanceof Error ? err.message : "Errore interno.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
