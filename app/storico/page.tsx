"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ScanResult } from "@/lib/types";

type ScanRow = {
  id: string;
  created_at: string;
  brand: string;
  model: string;
  reference: string | null;
  confidence: number;
  value_estimate: number | null;
  market_method: "provider" | "web_search" | "mock";
  result: ScanResult;
};

function formatEUR(n: number): string {
  return n.toLocaleString("it-IT");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportScansToCSV(scans: ScanRow[]) {
  const headers = [
    "Data",
    "Marca",
    "Modello",
    "Referenza",
    "Quadrante",
    "Confidence %",
    "Valore stimato EUR",
    "Fonte dato",
  ];

  const rows = scans.map((scan) => [
    new Date(scan.created_at).toLocaleString("it-IT"),
    scan.brand,
    scan.model,
    scan.reference ?? "",
    scan.result?.identification?.dialDescription ?? "",
    String(scan.confidence),
    scan.value_estimate != null ? String(scan.value_estimate) : "",
    METHOD_LABEL[scan.market_method],
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  // BOM per far riconoscere correttamente gli accenti a Excel
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `valutime-storico-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const METHOD_LABEL: Record<ScanRow["market_method"], string> = {
  provider: "Fonte dati",
  web_search: "Ricerca web",
  mock: "Demo",
};

export default function StoricoPage() {
  const supabase = createClient();
  const [scans, setScans] = useState<ScanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  async function exportScansToPDF(scans: ScanRow[]) {
    setPdfLoading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 16;
      let y = 20;

      function drawHeader() {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("ValuTime — Storico scansioni", margin, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(
          `Esportato il ${new Date().toLocaleString("it-IT")} — ${scans.length} scansioni`,
          margin,
          y
        );
        doc.setTextColor(0);
        y += 10;
        doc.setDrawColor(210);
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;
      }

      drawHeader();

      for (const scan of scans) {
        const dial = scan.result?.identification?.dialDescription;
        const blockHeight = dial ? 24 : 20;

        if (y + blockHeight > pageHeight - 20) {
          doc.addPage();
          y = 20;
          drawHeader();
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(`${scan.brand} ${scan.model}`, margin, y);
        y += 5.5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(90);
        doc.text(
          `Rif. ${scan.reference ?? "N/D"}${dial ? ` · Quadrante: ${dial}` : ""}`,
          margin,
          y
        );
        y += 5;
        doc.text(
          `Confidence ${scan.confidence}% · ${
            scan.value_estimate ? `Valore € ${scan.value_estimate.toLocaleString("it-IT")}` : "Valore N/D"
          } · ${METHOD_LABEL[scan.market_method]} · ${new Date(scan.created_at).toLocaleDateString("it-IT")}`,
          margin,
          y
        );
        doc.setTextColor(0);
        y += 6;
        doc.setDrawColor(230);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;
      }

      doc.setFontSize(8);
      doc.setTextColor(130);
      const disclaimer = doc.splitTextToSize(
        "Stime preliminari generate con intelligenza artificiale. Non sostituiscono una perizia professionale.",
        pageWidth - margin * 2
      );
      doc.text(disclaimer, margin, pageHeight - 12);

      doc.save(`valutime-storico-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("[exportScansToPDF]", err);
    } finally {
      setPdfLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (active) setError("Devi effettuare l'accesso per vedere lo storico.");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("scans")
        .select("id, created_at, brand, model, reference, confidence, value_estimate, market_method, result")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!active) return;

      if (fetchError) {
        setError("Impossibile caricare lo storico. Riprova.");
        return;
      }
      setScans((data as ScanRow[]) ?? []);
    }

    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <img src="/logo.png" alt="ValuTime" className="brand-logo" />
      </header>

      <section className="hero" style={{ paddingTop: 32 }}>
        <p className="eyebrow">LE TUE SCANSIONI</p>
        <h1 style={{ fontSize: 30 }}>Storico</h1>
        <p className="sub" style={{ marginTop: 8 }}>
          Le ultime {scans?.length ?? "…"} analisi salvate sul tuo account.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <a href="/" className="chip-btn" style={{ display: "inline-block", textDecoration: "none", width: "auto", padding: "10px 18px" }}>
            ← Nuova scansione
          </a>
          {scans && scans.length > 0 && (
            <button
              type="button"
              className="chip-btn"
              style={{ width: "auto", padding: "10px 18px" }}
              onClick={() => exportScansToCSV(scans)}
            >
              Esporta CSV
            </button>
          )}
          {scans && scans.length > 0 && (
            <button
              type="button"
              className="chip-btn"
              style={{ width: "auto", padding: "10px 18px" }}
              onClick={() => exportScansToPDF(scans)}
              disabled={pdfLoading}
            >
              {pdfLoading ? "Generazione…" : "Esporta PDF"}
            </button>
          )}
        </div>

        {error && (
          <div className="error-box" style={{ marginTop: 24 }}>
            <strong>Attenzione</strong>
            <span>{error}</span>
          </div>
        )}

        {!error && scans === null && (
          <div className="loading" style={{ marginTop: 32 }}>
            <div className="loader" />
            <div>
              <strong>Caricamento storico</strong>
              <span>Un attimo…</span>
            </div>
          </div>
        )}

        {!error && scans !== null && scans.length === 0 && (
          <div className="value-box" style={{ marginTop: 32 }}>
            <span>NESSUNA SCANSIONE ANCORA</span>
            <strong style={{ fontSize: 18 }}>Il tuo storico è vuoto</strong>
            <small>Le prossime analisi che farai compariranno qui.</small>
          </div>
        )}

        {!error && scans !== null && scans.length > 0 && (
          <div className="history-list">
            {scans.map((scan) => {
              const isOpen = expandedId === scan.id;
              const dial = scan.result?.identification?.dialDescription;
              return (
                <div className="history-card" key={scan.id}>
                  <button
                    type="button"
                    className="history-card-head"
                    onClick={() => setExpandedId(isOpen ? null : scan.id)}
                  >
                    <div>
                      <strong>{scan.brand} {scan.model}</strong>
                      <span className="history-meta">
                        {scan.reference ? `Ref. ${scan.reference}` : "Referenza N/D"}
                        {dial ? ` · ${dial}` : ""}
                      </span>
                      <span className="history-date">{formatDate(scan.created_at)}</span>
                    </div>
                    <div className="history-value">
                      {scan.value_estimate ? (
                        <strong>€ {formatEUR(scan.value_estimate)}</strong>
                      ) : (
                        <strong className="history-nd">N/D</strong>
                      )}
                      <span>{METHOD_LABEL[scan.market_method]}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="history-detail">
                      <div className="history-detail-row">
                        <span>Confidence identificazione</span>
                        <b>{scan.confidence}%</b>
                      </div>
                      {scan.result?.valuation?.sampleSize > 0 && (
                        <div className="history-detail-row">
                          <span>Range di mercato</span>
                          <b>
                            € {formatEUR(scan.result.valuation.min)} – €{" "}
                            {formatEUR(scan.result.valuation.max)}
                          </b>
                        </div>
                      )}
                      {scan.result?.identification?.authenticity && (
                        <div className="history-detail-row">
                          <span>Autenticità</span>
                          <b>
                            {scan.result.identification.authenticity.verdict === "clear"
                              ? "Nessun segnale"
                              : `${scan.result.identification.authenticity.signals.length} segnali da verificare`}
                          </b>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
