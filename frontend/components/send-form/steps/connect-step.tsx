'use client';

import { useState } from 'react';
import { connectFreighter, WalletConnectError } from '@/lib/wallet';
import { ChainSelector } from '@/components/chain-selector';
import { analytics, ERROR_TYPES, WALLET_PROVIDERS } from '@/lib/analytics';

type ConnectStepProps = {
  publicKey: string;
  onConnected: (publicKey: string) => void;
};

/**
 * Machine-readable connect failure code, falling back to `'UNKNOWN'` for a
 * non-`WalletConnectError` throw so the event still reports something rather
 * than being dropped.
 */
function classifyConnectError(err: unknown): string {
  return err instanceof WalletConnectError ? err.code : 'UNKNOWN';
}

export function ConnectStep({ publicKey, onConnected }: ConnectStepProps) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setStatus('connecting');
    setError(null);
    try {
      const wallet = await connectFreighter();
      setStatus('idle');
      onConnected(wallet.publicKey);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to connect wallet.');
      // Freighter is the only provider this step can attempt, so the attempt
      // itself identifies the provider even when the failure happened before
      // Freighter responded (extension missing, user rejected).
      analytics.walletConnectionFailed({
        walletProvider: WALLET_PROVIDERS.freighter,
        errorCode: classifyConnectError(err),
      });
      // Sender's wallet refused connection (§6 `wallet_connection_failed`).
      analytics.errorDisplayed({
        journey: 'sender',
        errorType: ERROR_TYPES.wallet_connection_failed,
        errorCode: classifyConnectError(err),
        sourceScreen: 'send_form_connect',
      });
    }
  }

  if (publicKey) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950">
        <p className="text-sm font-medium text-green-800 dark:text-green-300">Wallet connected</p>
        <p className="mt-0.5 break-all font-mono text-xs text-green-700 dark:text-green-400">
          {publicKey}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Connect your wallet to authorise payments. No password required — signing with your key
        proves you control the address.
      </p>

      <div className="py-2">
        <ChainSelector />
      </div>
      <button
        type="button"
        onClick={handleConnect}
        disabled={status === 'connecting'}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {status === 'connecting' ? 'Connecting…' : 'Connect Freighter Wallet'}
      </button>
      {status === 'error' && error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <a
          href="https://docs.freighter.app"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Install Freighter
        </a>
      </p>
    </div>
  );
}
