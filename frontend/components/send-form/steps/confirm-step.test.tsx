import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmStep } from './confirm-step';
import type { SendFormState } from '../index';
import { createEphemeralAccount } from '@/lib/bridgelet';
import { fundEphemeralAccount, FundingError } from '@/lib/fund-ephemeral-account';
import { tryFreighterSenderSigning } from '@/lib/freighter-sender-signing';
import { analytics } from '@/lib/analytics';

vi.mock('@/lib/bridgelet', () => ({
  createEphemeralAccount: vi.fn(),
  getAssetIssuer: vi.fn(),
}));

vi.mock('@/lib/fund-ephemeral-account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fund-ephemeral-account')>();
  return {
    ...actual,
    fundEphemeralAccount: vi.fn(),
  };
});

vi.mock('@/lib/freighter-sender-signing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/freighter-sender-signing')>();
  return {
    ...actual,
    tryFreighterSenderSigning: vi.fn(),
    toCreateAccountRequestWithFreighterSignature: vi.fn(),
  };
});

vi.mock('@/lib/analytics', () => ({
  analytics: {
    paymentConfirmationViewed: vi.fn(),
    paymentConfirmed: vi.fn(),
    paymentCreated: vi.fn(),
    paymentCreationFailed: vi.fn(),
    paymentDetailsViewed: vi.fn(),
    claimLinkCopied: vi.fn(),
    claimLinkShared: vi.fn(),
  },
}));

vi.mock('@/hooks/use-nfc', () => ({
  useNfc: () => ({ isSupported: false, writeUrl: vi.fn(), isWriting: false, error: null }),
}));

describe('ConfirmStep - Payment Creation Failed analytics', () => {
  const defaultState: SendFormState = {
    publicKey: 'G' + 'A'.repeat(55),
    amountXlm: '10',
    assetCode: 'USDC',
    expiresInHours: 24,
    expiresIn: 24 * 3600,
    recipientName: 'Alice',
    recipientEmail: '',
    memo: 'Test gift',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires analytics.paymentCreationFailed when funding fails after signing', async () => {
    const user = userEvent.setup();

    vi.mocked(tryFreighterSenderSigning).mockResolvedValueOnce({
      mode: 'backend',
    } as any);

    vi.mocked(createEphemeralAccount).mockResolvedValueOnce({
      accountId: 'acc_123',
      publicKey: 'G' + 'B'.repeat(55),
      claimUrl: 'https://bridgelet.org/claim/tok_123',
      amount: '10',
      asset: 'USDC',
      status: 'pending_payment',
      createdAt: '2026-03-15T10:00:00.000Z',
      expiresAt: '2026-03-22T10:00:00.000Z',
    });

    vi.mocked(fundEphemeralAccount).mockRejectedValueOnce(
      new FundingError('SUBMIT_FAILED', 'Network error on submit'),
    );

    render(<ConfirmStep state={defaultState} usdRate={null} onBack={vi.fn()} />);

    const confirmBtn = screen.getByRole('button', { name: /confirm & send/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(analytics.paymentCreationFailed).toHaveBeenCalledTimes(1);
    });

    expect(analytics.paymentConfirmed).toHaveBeenCalledWith({
      assetType: 'USDC',
      expiryDays: 1,
      walletType: 'Freighter',
    });

    expect(analytics.paymentCreationFailed).toHaveBeenCalledWith({
      assetType: 'USDC',
      errorCode: 'SUBMIT_FAILED',
    });

    expect(analytics.paymentCreated).not.toHaveBeenCalled();
  });

  it('fires analytics.paymentCreationFailed when ephemeral account creation fails', async () => {
    const user = userEvent.setup();

    vi.mocked(tryFreighterSenderSigning).mockResolvedValueOnce({
      mode: 'backend',
    } as any);

    vi.mocked(createEphemeralAccount).mockRejectedValueOnce(
      new Error('API server timeout'),
    );

    render(<ConfirmStep state={defaultState} usdRate={null} onBack={vi.fn()} />);

    const confirmBtn = screen.getByRole('button', { name: /confirm & send/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(analytics.paymentCreationFailed).toHaveBeenCalledTimes(1);
    });

    expect(analytics.paymentCreationFailed).toHaveBeenCalledWith({
      assetType: 'USDC',
      errorCode: 'NETWORK_FAILURE',
    });
  });

  it('fires analytics.paymentCreated on success and not paymentCreationFailed', async () => {
    const user = userEvent.setup();

    vi.mocked(tryFreighterSenderSigning).mockResolvedValueOnce({
      mode: 'backend',
    } as any);

    vi.mocked(createEphemeralAccount).mockResolvedValueOnce({
      accountId: 'acc_success',
      publicKey: 'G' + 'B'.repeat(55),
      claimUrl: 'https://bridgelet.org/claim/tok_success',
      amount: '10',
      asset: 'USDC',
      status: 'pending_payment',
      createdAt: '2026-03-15T10:00:00.000Z',
      expiresAt: '2026-03-22T10:00:00.000Z',
    });

    vi.mocked(fundEphemeralAccount).mockResolvedValueOnce({
      txHash: 'tx_hash_123',
    });

    render(<ConfirmStep state={defaultState} usdRate={null} onBack={vi.fn()} />);

    const confirmBtn = screen.getByRole('button', { name: /confirm & send/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(analytics.paymentCreated).toHaveBeenCalledTimes(1);
    });

    expect(analytics.paymentCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        claimId: 'acc_success',
        assetType: 'USDC',
        expiryDays: 1,
      }),
    );

    expect(analytics.paymentCreationFailed).not.toHaveBeenCalled();
  });
});

