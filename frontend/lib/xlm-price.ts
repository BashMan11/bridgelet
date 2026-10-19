// #120 – Fetch XLM/USD rate and display claim amount in XLM + fiat
const STROOPS_PER_XLM = 10_000_000;
const CACHE_MS = 60_000;

let cached: { rate: number; at: number } | null = null;

export async function getXlmUsdRate(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rate;

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { next: { revalidate: 60 } },
    );
    const data = (await res.json()) as { stellar?: { usd?: number } };
    const rate = data.stellar?.usd ?? 0;
    cached = { rate, at: Date.now() };
    return rate;
  } catch {
    return cached?.rate ?? 0;
  }
}

export function stroopsToXlm(stroops: string): number {
  return parseInt(stroops, 10) / STROOPS_PER_XLM;
}

export function formatFiat(xlm: number, rate: number): string {
  return (xlm * rate).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * USD equivalent of a payment amount, for the §3.2 `amount_usd_equiv`
 * conditional property.
 *
 * Returns `undefined` — so the caller omits the property entirely — whenever
 * the answer is not known: a missing rate, an unparseable amount, or a
 * non-positive amount. Sending `0` instead would be actively wrong, because
 * volume and revenue KPIs sum this field, and one unpriced payment would
 * silently pull a reported figure down rather than showing up as a gap.
 *
 * A USD-pegged asset is its own USD equivalent and needs no XLM rate, which
 * is why this works for USDC while the app is still rate-dependent for XLM.
 */
export function amountUsdEquiv(
  amount: string | number | null | undefined,
  assetCode: string | null | undefined,
  xlmUsdRate: number | null | undefined,
): number | undefined {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  const code = (assetCode ?? '').toUpperCase();
  if (code !== '' && code !== 'XLM' && code !== 'NATIVE') {
    // Issued assets are assumed to be USD-denominated, which is the only
    // denomination the send form currently offers alongside XLM.
    return Math.round(value * 100) / 100;
  }

  if (xlmUsdRate == null || !Number.isFinite(xlmUsdRate) || xlmUsdRate <= 0) return undefined;
  return Math.round(value * xlmUsdRate * 100) / 100;
}
