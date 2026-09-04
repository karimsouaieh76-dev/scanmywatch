"use client";

import { useRef, useState } from "react";
import type { ScanResult } from "@/lib/types";

const MAX_PHOTOS = 4;

type Photo = { file: File; preview: string };

function formatEUR(n: number): string {
  return n.toLocaleString("it-IT");
}

function buildShareText(result: ScanResult): string {
  const { identification, valuation } = result;
  const name = `${identification.brand} ${identification.model}`.trim();
  const ref = identification.reference ? ` (ref. ${identification.reference})` : "";
  const value =
    valuation.sampleSize > 0
      ? `Valore stimato: € ${formatEUR(valuation.value)}`
      : "Valore di mercato non disponibile";
  return `${name}${ref} — ${value} — identificato con LUXSCAN AI`;
}

  async function scan() {
    if (photos.length === 0) return;
    setLoading(true);
    setError(null);

    let stage = "preparazione richiesta";
    try {
      const formData = new FormData();
      photos.forEach((p) => formData.append("photos", p.file));

      stage = "invio della richiesta al server";
      const res = await fetch("/api/identify", { method: "POST", body: formData });

      stage = "lettura della risposta del server";
      const rawText = await res.text();

      stage = "interpretazione della risposta (JSON)";
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        throw new Error(
          `Risposta del server non valida (stato ${res.status}). Anteprima: ${rawText.slice(0, 200)}`
        );
      }

      if (!res.ok) {
        const errData = data as { error?: string };
        throw new Error(errData?.error ?? `Analisi fallita (stato ${res.status}).`);
      }

      setResult(data as ScanResult);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Errore";
      const message = err instanceof Error ? err.message : String(err);
      setError(`[${stage}] ${name}: ${message}`);
    } finally {
      setLoading(false);
    }
  }

function dataUrlFormat(dataUrl: string): "PNG" | "WEBP" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

export default function Scanner() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  function addPhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const newPhotos = Array.from(fileList)
      .slice(0, Math.max(0, MAX_PHOTOS - photos.length))
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));

    setPhotos((prev) => [...prev, ...newPhotos]);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
  }

  async function scan() {
    if (photos.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      photos.forEach((p) => formData.append("photos", p.file));

      const res = await fetch("/api/identify", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "Analisi fallita.");
      }

      setResult(data as ScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore imprevisto durante l'analisi.");
    } finally {
      setLoading(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    const text = buildShareText(result);

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "LUXSCAN AI", text, url: window.location.href });
      } catch {
        // L'utente ha annullato la condivisione: nessun errore da mostrare.
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${text} — ${window.location.href}`);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2200);
      } catch {
        // Silenzioso: nel peggiore dei casi l'utente copia a mano.
      }
    }
  }

  async function exportPdf() {
    if (!result) return;
    setPdfLoading(true);
    setPdfError(null);

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("LUXSCAN AI — Scheda di valutazione", margin, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(new Date().toLocaleString("it-IT"), margin, y);
      doc.setTextColor(0);
      y += 10;

      // Foto (fino a 4, disposte 2 per riga)
      if (photos.length > 0) {
        const imgW = (pageWidth - margin * 2 - 6) / 2;
        const imgH = imgW * 0.75;
        let col = 0;
        for (const photo of photos) {
          try {
            const dataUrl = await blobUrlToDataUrl(photo.preview);
            const x = margin + col * (imgW + 6);
            doc.addImage(dataUrl, dataUrlFormat(dataUrl), x, y, imgW, imgH, undefined, "FAST");
            col++;
            if (col === 2) {
              col = 0;
              y += imgH + 6;
            }
          } catch {
            // Se una foto non si converte, si prosegue senza bloccare il PDF.
          }
        }
        if (col === 1) y += imgH + 6;
        y += 4;
      }

      doc.setDrawColor(210);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(`${result.identification.brand} ${result.identification.model}`, margin, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Referenza: ${result.identification.reference ?? "N/D"}`, margin, y);
      y += 6;
      doc.text(`Confidence identificazione: ${result.identification.confidence}%`, margin, y);
      y += 10;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Valore di mercato", margin, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      if (result.valuation.sampleSize > 0) {
        doc.text(`Stima: € ${formatEUR(result.valuation.value)}`, margin, y);
        y += 6;
        doc.text(
          `Range: € ${formatEUR(result.valuation.min)} – € ${formatEUR(result.valuation.max)} (${result.valuation.sampleSize} comparabili)`,
          margin,
          y
        );
        y += 6;
        const sourceLabel =
          result.market.method === "mock"
            ? "Fonte: dati demo, non di mercato reale"
            : result.market.method === "web_search"
            ? "Fonte: stima da ricerca web"
            : "Fonte: provider dati di mercato";
        doc.text(sourceLabel, margin, y);
        y += 6;
        doc.text(`Prezzo acquisto target: € ${formatEUR(result.valuation.buyTarget)}`, margin, y);
        y += 6;
        doc.text(`Prezzo vendita target: € ${formatEUR(result.valuation.sellTarget)}`, margin, y);
        y += 10;
      } else {
        doc.text("Nessun dato di mercato disponibile per questa referenza.", margin, y);
        y += 10;
      }

      if (result.identification.authenticity) {
        const a = result.identification.authenticity;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Controllo preliminare di autenticità", margin, y);
        y += 7;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        if (a.verdict === "clear") {
          doc.text("Nessun segnale sospetto rilevato.", margin, y);
          y += 6;
        } else {
          for (const signal of a.signals) {
            const lines = doc.splitTextToSize(`• ${signal}`, pageWidth - margin * 2);
            doc.text(lines, margin, y);
            y += 5 * lines.length + 1;
          }
        }
        y += 4;
      }

      doc.setFontSize(8);
      doc.setTextColor(130);
      const disclaimer = doc.splitTextToSize(
        "Stima preliminare generata con intelligenza artificiale. Non sostituisce una perizia professionale. Il valore finale dipende da condizioni, corredo, autenticità e dati di mercato aggiornati.",
        pageWidth - margin * 2
      );
      doc.text(disclaimer, margin, 285);

      const fileSlug = `${result.identification.brand}-${result.identification.model}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      doc.save(`luxscan-${fileSlug || "scheda"}.pdf`);
    } catch (err) {
      setPdfError("Generazione PDF non riuscita. Riprova.");
      console.error("[exportPdf]", err);
    } finally {
      setPdfLoading(false);
    }
  }

  const canAddMore = photos.length < MAX_PHOTOS;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">LUX<span>SCAN</span><small>AI</small></div>
        <div className="status"><i /> AI ENGINE READY</div>
      </header>

      <section className="hero">
        <p className="eyebrow">LUXURY WATCH INTELLIGENCE</p>
        <h1>Identifica.<br /><em>Valuta.</em> Decidi.</h1>
        <p className="sub">
          Fotografa un orologio (anche più foto: quadrante e fondo cassa) e
          LUXSCAN AI analizzerà modello, referenza e valore di mercato.
        </p>

        <div className="scanner-card">
          {photos.length === 0 ? (
            <div className="photo-area">
              <div className="empty">
                <div className="camera">⌾</div>
                <strong>Inserisci una o più fotografie</strong>
                <span>Quadrante, fondo cassa, bracciale — da fotocamera o galleria</span>
              </div>
            </div>
          ) : (
            <div className="photo-grid">
              {photos.map((p, i) => (
                <div className="photo-thumb" key={p.preview}>
                  <img src={p.preview} alt={`Foto ${i + 1}`} />
                  <button
                    type="button"
                    className="remove"
                    onClick={() => removePhoto(i)}
                    aria-label="Rimuovi foto"
                  >
                    ×
                  </button>
                </div>
              ))}
              {canAddMore && (
                <button
                  type="button"
                  className="photo-add-tile"
                  onClick={() => inputRef.current?.click()}
                >
                  <span>+</span>
                  Aggiungi
                </button>
              )}
            </div>
          )}

          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => addPhotos(e.target.files)}
          />

          <div className="actions">
            <button className="primary" onClick={() => inputRef.current?.click()} disabled={!canAddMore}>
              {photos.length === 0 ? "SCEGLI FOTO →" : "AGGIUNGI ALTRA FOTO"}
            </button>
            {photos.length > 0 && (
              <button className="secondary" onClick={scan} disabled={loading}>
                {loading ? "ANALISI IN CORSO…" : "ANALIZZA CON AI →"}
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="loading">
            <div className="loader" />
            <div><strong>Analisi AI in corso</strong><span>Identificazione di marca, modello e referenza…</span></div>
          </div>
        )}

        {error && !loading && (
          <div className="error-box">
            <strong>Analisi non riuscita</strong>
            <span>{error}</span>
          </div>
        )}

        {result && !loading && (
          <section className="result">
            <div className="result-head">
              <div>
                <p className="eyebrow">AI IDENTIFICATION</p>
                <h2>{result.identification.brand} {result.identification.model}</h2>
                <p className="ref">
                  REF. <b>{result.identification.reference ?? "N/D"}</b>
                </p>
              </div>
              <div className="confidence">
                <b>{result.identification.confidence}%</b>
                <span>CONFIDENCE</span>
              </div>
            </div>

            {result.valuation.sampleSize > 0 ? (
              <>
                <div className="value-box">
                  <span>VALORE DI MERCATO STIMATO</span>
                  <strong>€ {formatEUR(result.valuation.value)}</strong>
                  <small>
                    Range € {formatEUR(result.valuation.min)} – €{" "}
                    {formatEUR(result.valuation.max)} · basato su{" "}
                    {result.valuation.sampleSize} comparabili
                    {result.market.method === "mock" &&
                      " (dati demo, non di mercato reale)"}
                    {result.market.method === "web_search" &&
                      " (stima da ricerca web, verificare prima di usarla come riferimento)"}
                  </small>
                </div>

                <div className="grid">
                  <div>
                    <span>PREZZO ACQUISTO TARGET</span>
                    <b>€ {formatEUR(result.valuation.buyTarget)}</b>
                  </div>
                  <div>
                    <span>PREZZO VENDITA TARGET</span>
                    <b>€ {formatEUR(result.valuation.sellTarget)}</b>
                  </div>
                </div>
              </>
            ) : (
              <div className="value-box">
                <span>VALORE DI MERCATO</span>
                <strong>Non disponibile</strong>
                <small>
                  Nessun dato di mercato trovato per questa referenza.
                  {!result.identification.reference &&
                    " Prova ad aggiungere una foto del fondo cassa: la referenza è spesso incisa lì."}
                </small>
              </div>
            )}

            {result.identification.authenticity && (
              <div
                className={
                  "authenticity-box " +
                  (result.identification.authenticity.verdict === "clear" ? "clear" : "attention")
                }
              >
                <span>CONTROLLO PRELIMINARE DI AUTENTICITÀ</span>
                {result.identification.authenticity.verdict === "clear" ? (
                  <strong>Nessun segnale sospetto rilevato</strong>
                ) : (
                  <>
                    <strong>Segnali da verificare</strong>
                    <ul>
                      {result.identification.authenticity.signals.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
                <small>Non sostituisce una perizia fisica professionale.</small>
              </div>
            )}

            {result.identification.notes && (
              <p className="disclaimer">{result.identification.notes}</p>
            )}
            <p className="disclaimer">
              Stima preliminare AI. Il valore finale dipende da condizioni, corredo,
              autenticità e dati di mercato aggiornati.
            </p>

            <div className="result-actions">
              <button type="button" className="chip-btn" onClick={shareResult}>
                {shareCopied ? "Copiato negli appunti ✓" : "Condividi"}
              </button>
              <button type="button" className="chip-btn" onClick={exportPdf} disabled={pdfLoading}>
                {pdfLoading ? "Generazione PDF…" : "Esporta PDF"}
              </button>
            </div>
            {pdfError && <p className="disclaimer" style={{ color: "#E3A98F" }}>{pdfError}</p>}
          </section>
        )}
      </section>
    </main>
  );
}
