"use client";

import { useRef, useState } from "react";
import type { ScanResult } from "@/lib/types";

const MAX_PHOTOS = 4;
const MAX_RAW_FILE_MB = 25; // oltre questa soglia rifiutiamo prima ancora di provare a comprimere

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
  return `${name}${ref} — ${value} — identificato con ValuTime`;
}

async function blobUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlFormat(dataUrl: string): "PNG" | "WEBP" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

/**
 * Ridimensiona/ricomprime un'immagine nel browser prima dell'invio, per
 * restare sotto il limite di 4,5MB per richiesta delle funzioni serverless
 * di Vercel. Le foto scattate da smartphone spesso pesano 2-5MB l'una: con
 * 3-4 foto si supera facilmente il limite senza questo passaggio.
 */
async function compressImage(
  file: File,
  maxDimension = 1800,
  quality = 0.82
): Promise<File> {
  // File già piccoli: non serve comprimere, si risparmia tempo.
  if (file.size < 400 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    // Se la compressione fallisce per qualsiasi motivo, invia l'originale
    // piuttosto che bloccare l'utente.
    return file;
  }
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
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editBrand, setEditBrand] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editReference, setEditReference] = useState("");
  const [editDialDescription, setEditDialDescription] = useState("");
  const [revaluing, setRevaluing] = useState(false);
  const [revalueError, setRevalueError] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState("Lettura delle fotografie…");
  const [loadingProgress, setLoadingProgress] = useState(0);

  async function addPhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const allSelected = Array.from(fileList);
    const remainingSlots = Math.max(0, MAX_PHOTOS - photos.length);

    const accepted: File[] = [];
    const problems: string[] = [];

    allSelected.forEach((file) => {
      if (accepted.length >= remainingSlots) return;
      if (!file.type.startsWith("image/")) {
        problems.push(`"${file.name}" non è un'immagine.`);
        return;
      }
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > MAX_RAW_FILE_MB) {
        problems.push(`"${file.name}" è troppo pesante (${sizeMB.toFixed(0)} MB, massimo ${MAX_RAW_FILE_MB} MB).`);
        return;
      }
      accepted.push(file);
    });

    if (allSelected.length > remainingSlots + problems.length) {
      problems.push(`Puoi avere al massimo ${MAX_PHOTOS} foto: alcune sono state ignorate.`);
    }

    setPhotoError(problems.length > 0 ? problems.join(" ") : null);

    if (accepted.length === 0) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setProcessingPhotos(true);
    try {
      const compressed = await Promise.all(accepted.map((file) => compressImage(file)));
      const newPhotos = compressed.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));

      setPhotos((prev) => [...prev, ...newPhotos]);
      setResult(null);
      setError(null);
    } finally {
      setProcessingPhotos(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setResult(null);
  }

  async function scan() {
    if (photos.length === 0) return;
    setLoading(true);
    setError(null);
    setLoadingStage("Lettura delle fotografie…");
    setLoadingProgress(4);

    const stageTimers = [
      setTimeout(() => setLoadingStage("Identificazione di marca, modello e referenza…"), 3000),
      setTimeout(() => setLoadingStage("Ricerca dei prezzi di mercato…"), 9000),
      setTimeout(() => setLoadingStage("Quasi fatto…"), 16000),
    ];

    // Avanza in modo asintotico verso il 92% (mai il 100%, che arriva solo
    // a richiesta davvero completata) — dà la sensazione di progresso reale
    // senza promettere un tempo di completamento che non conosciamo.
    const progressInterval = setInterval(() => {
      setLoadingProgress((prev) => (prev >= 92 ? 92 : prev + (92 - prev) * 0.08));
    }, 350);

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
      setLoadingProgress(100);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Errore";
      const message = err instanceof Error ? err.message : String(err);
      setError(`[${stage}] ${name}: ${message}`);
    } finally {
      stageTimers.forEach(clearTimeout);
      clearInterval(progressInterval);
      setLoading(false);
    }
  }

  function startEdit() {
    if (!result) return;
    setEditBrand(result.identification.brand);
    setEditModel(result.identification.model);
    setEditReference(result.identification.reference ?? "");
    setEditDialDescription(result.identification.dialDescription ?? "");
    setRevalueError(null);
    setEditMode(true);
  }

  async function saveManualEdit() {
    if (!result) return;
    if (!editBrand.trim() || !editModel.trim()) {
      setRevalueError("Marca e modello sono obbligatori.");
      return;
    }
    setRevaluing(true);
    setRevalueError(null);

    try {
      const res = await fetch("/api/revalue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: editBrand.trim(),
          model: editModel.trim(),
          reference: editReference.trim() || null,
          dialDescription: editDialDescription.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Aggiornamento non riuscito.");

      setResult((prev) =>
        prev
          ? {
              identification: {
                ...data.identification,
                authenticity: prev.identification.authenticity,
              },
              market: data.market,
              valuation: data.valuation,
            }
          : prev
      );
      setEditMode(false);
    } catch (err) {
      setRevalueError(err instanceof Error ? err.message : "Errore imprevisto.");
    } finally {
      setRevaluing(false);
    }
  }

  async function shareResult() {
    if (!result) return;
    const text = buildShareText(result);

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ValuTime", text, url: window.location.href });
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
      doc.text("ValuTime — Scheda di valutazione", margin, y);
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
      if (result.identification.dialDescription) {
        doc.text(`Quadrante: ${result.identification.dialDescription}`, margin, y);
        y += 6;
      }
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

      if (result.identification.warranty) {
        const w = result.identification.warranty;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Garanzia rilevata", margin, y);
        y += 7;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        if (w.retailer) {
          doc.text(`Rivenditore: ${w.retailer}`, margin, y);
          y += 6;
        }
        if (w.purchaseDate) {
          doc.text(`Data acquisto: ${w.purchaseDate}`, margin, y);
          y += 6;
        }
        if (w.serialNumber) {
          doc.text(`Numero di serie: ${w.serialNumber}`, margin, y);
          y += 6;
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
      doc.save(`valutime-${fileSlug || "scheda"}.pdf`);
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
        <img src="/logo.png" alt="ValuTime" className="brand-logo" />
        <div className="status"><i /> AI ENGINE READY</div>
      </header>

      <section className="hero">
        <p className="eyebrow">LUXURY WATCH INTELLIGENCE</p>
        <h1>Identifica.<br /><em>Valuta.</em> Decidi.</h1>
        <p className="sub">
          Fotografa un orologio (anche più foto: quadrante e fondo cassa) e
          ValuTime analizzerà modello, referenza e valore di mercato.
        </p>

        <div className="scanner-card">
          {photos.length === 0 ? (
            <div className="photo-area">
              <div className="empty">
                <div className="camera">⌾</div>
                <strong>Inserisci una o più fotografie</strong>
                <span>Quadrante, fondo cassa, bracciale, garanzia — da fotocamera o galleria</span>
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

          {photoError && <p className="photo-error">{photoError}</p>}

          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => { addPhotos(e.target.files); }}
          />

          <div className="actions">
            <button
              className="primary"
              onClick={() => inputRef.current?.click()}
              disabled={!canAddMore || processingPhotos}
            >
              {processingPhotos
                ? "ELABORAZIONE FOTO…"
                : photos.length === 0
                ? "SCEGLI FOTO →"
                : "AGGIUNGI ALTRA FOTO"}
            </button>
            {photos.length > 0 && (
              <button className="secondary" onClick={scan} disabled={loading || processingPhotos}>
                {loading ? "ANALISI IN CORSO…" : "ANALIZZA CON AI →"}
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="loading">
            <div className="loader" />
            <div style={{ flex: 1 }}>
              <strong>Analisi AI in corso</strong>
              <span>{loadingStage}</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${loadingProgress}%` }} />
              </div>
            </div>
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
              <div style={{ flex: 1 }}>
                <p className="eyebrow">AI IDENTIFICATION</p>
                {editMode ? (
                  <div className="edit-fields">
                    <input
                      className="auth-input"
                      placeholder="Marca"
                      value={editBrand}
                      onChange={(e) => setEditBrand(e.target.value)}
                    />
                    <input
                      className="auth-input"
                      placeholder="Modello"
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                    />
                    <input
                      className="auth-input"
                      placeholder="Referenza (opzionale)"
                      value={editReference}
                      onChange={(e) => setEditReference(e.target.value)}
                    />
                    <input
                      className="auth-input"
                      placeholder="Quadrante (es. nero, blu, panda...)"
                      value={editDialDescription}
                      onChange={(e) => setEditDialDescription(e.target.value)}
                    />
                    {revalueError && <p className="form-error">{revalueError}</p>}
                    <div className="result-actions" style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={() => setEditMode(false)}
                        disabled={revaluing}
                      >
                        Annulla
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        onClick={saveManualEdit}
                        disabled={revaluing}
                      >
                        {revaluing ? "Aggiornamento…" : "Salva e aggiorna valore"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2>{result.identification.brand} {result.identification.model}</h2>
                    <p className="ref">
                      REF. <b>{result.identification.reference ?? "N/D"}</b>
                    </p>
                    {result.identification.dialDescription && (
                      <p className="ref">
                        QUADRANTE <b>{result.identification.dialDescription}</b>
                      </p>
                    )}
                  </>
                )}
              </div>
              {!editMode && (
                <div className="confidence">
                  <b>{result.identification.confidence}%</b>
                  <span>CONFIDENCE</span>
                </div>
              )}
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

            {result.identification.warranty && (
              <div className="authenticity-box clear">
                <span>GARANZIA RILEVATA</span>
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
                  {result.identification.warranty.retailer && (
                    <li>Rivenditore: {result.identification.warranty.retailer}</li>
                  )}
                  {result.identification.warranty.purchaseDate && (
                    <li>Data acquisto: {result.identification.warranty.purchaseDate}</li>
                  )}
                  {result.identification.warranty.serialNumber && (
                    <li>Numero di serie: {result.identification.warranty.serialNumber}</li>
                  )}
                </ul>
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
              {!editMode && (
                <button type="button" className="chip-btn" onClick={startEdit}>
                  Modifica dati
                </button>
              )}
              <button type="button" className="chip-btn" onClick={shareResult} disabled={editMode}>
                {shareCopied ? "Copiato negli appunti ✓" : "Condividi"}
              </button>
              <button type="button" className="chip-btn" onClick={exportPdf} disabled={pdfLoading || editMode}>
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
