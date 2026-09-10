import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { identifyWatch, type WatchImage } from "@/lib/vision";
import { getMarketData } from "@/lib/marketData";
import { computeValuation } from "@/lib/valuation";
import { createClient } from "@/lib/supabase/server";
import { checkQuota } from "@/lib/quota";
import type { ScanResult } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per immagine
const MAX_IMAGES = 4;
const CACHE_HOURS = 6;

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
    const buffers = await Promise.all(files.map((file) => file.arrayBuffer()));

    // Hash combinato di tutte le foto (nell'ordine caricato) — stessa foto,
    // stesso hash, così possiamo riusare un risultato recente invece di
    // rifare identificazione + ricerca di mercato da capo.
    const hash = createHash("sha256");
    for (const buf of buffers) hash.update(Buffer.from(buf));
    const photoHash = hash.digest("hex");

    const cacheThreshold = new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("scan_cache")
      .select("result")
      .eq("photo_hash", photoHash)
      .gt("created_at", cacheThreshold)
      .maybeSingle();

    let result: ScanResult;

    if (cached?.result) {
      result = cached.result as ScanResult;
    } else {
      const images: WatchImage[] = buffers.map((buf, i) => ({
        base64: Buffer.from(buf).toString("base64"),
        mediaType: files[i].type as WatchImage["mediaType"],
      }));

      const identification = await identifyWatch(images);
      const market = await getMarketData(identification);
      const valuation = computeValuation(market);
      result = { identification, market, valuation };

      // Salva in cache — non blocca la risposta se fallisce.
      const { error: cacheError } = await supabase
        .from("scan_cache")
        .upsert({ photo_hash: photoHash, result }, { onConflict: "photo_hash" });
      if (cacheError) {
        console.error("[/api/identify] salvataggio cache fallito:", cacheError);
      }
    }

    const { identification, market, valuation } = result;

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
