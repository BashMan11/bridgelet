/**
 * Stellar block-explorer links for the recipient claim flow.
 *
 * Two things live here rather than in a component, because getting either one
 * wrong is not a cosmetic bug:
 *
 * 1. **A transaction hash is required.** `stellar.expert/explorer/<net>/tx/<id>`
 * takes a transaction hash. The claim page previously built that URL from the
 * claim token, which is a bearer credential for the money *and* is not a
 * transaction hash — so the link could not resolve and the token was sent to a
 * third party on a page that `docs/security-model.mdx` (T-16) explicitly
 * forbids third-party scripts for. Callers pass `undefined` until an actual
 * sweep hash is available, and must not substitute another identifier.
 *
 * 2. **The explorer differs by network.** Testnet and mainnet transactions are
 * not on the same explorer instance, so the network is part of the URL and is
 * also what `Explorer Link Clicked.explorer` reports.
 */

/** Networks the claim flow can run against. */
export type StellarNetwork = 'testnet' | 'mainnet';

export const EXPLORER_NAMES = {
  testnet: 'stellar_expert_testnet',
  mainnet: 'stellar_expert',
} as const;

export type ExplorerName = (typeof EXPLORER_NAMES)[keyof typeof EXPLORER_NAMES];

/** Human-facing display name per explorer, for the analytics `explorer` value. */
export function explorerName(network: StellarNetwork): ExplorerName {
  return EXPLORER_NAMES[network];
}

const BASE_URL: Record<StellarNetwork, string> = {
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
};

/** The network this frontend is configured for. */
export function currentStellarNetwork(): StellarNetwork {
  return process.env['NEXT_PUBLIC_CRYPTO_NETWORK'] === 'stellar-mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Transaction URL for a sweep, or `null` when there is no transaction hash.
 *
 * A `null` return is meaningful: the caller must not render a link rather than
 * linking something that cannot work.
 */
export function explorerTxUrl(
  network: StellarNetwork,
  txHash: string | null | undefined,
): string | null {
  // A transaction hash is a 64-character lowercase hex string. Anything else
  // is a claim id, an account id, or a truncated value — none of which belong
  // in a `/tx/` path.
  if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash.trim())) return null;
  return `${BASE_URL[network]}/tx/${txHash.trim().toLowerCase()}`;
}