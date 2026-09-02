import type { MarketData, Valuation } from "./types";

const FALLBACK_BUY_DISCOUNT = 0.85; // target d'acquisto: -15% dal valore stimato
const FALLBACK_SELL_PREMIUM = 1.0; // target di vendita: al valore stimato

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Deriva una valutazione (valore centrale, range, target acquisto/vendita)
 * a partire dai comparabili di mercato. Usa la mediana invece della media
 * per essere più robusto a outlier (es. un'inserzione anomala).
 */
export function computeValuation(market: MarketData): Valuation {
  const prices = market.comps.map((c) => c.price);

  if (prices.length === 0) {
    return { value: 0, min: 0, max: 0, buyTarget: 0, sellTarget: 0, sampleSize: 0 };
  }

  const value = median(prices);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return {
    value,
    min,
    max,
    buyTarget: Math.round(value * FALLBACK_BUY_DISCOUNT),
    sellTarget: Math.round(value * FALLBACK_SELL_PREMIUM),
    sampleSize: prices.length,
  };
}
