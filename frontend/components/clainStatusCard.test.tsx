import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimStatusCard } from './claim-status-card';
import { RateLimitError } from '@/lib/api/client';
import { ClaimError } from '@/lib/claim-errors';
import { analytics } from '@/lib/analytics';
import { AccountStatus } from '@/lib/api/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/components/rate-limit-banner', () => ({
  RateLimitBanner: ({ retryAfter }: { retryAfter: number | null }) => (
    <div data-testid="rate-limit-banner">retry: {String(retryAfter)}</div>
  ),
}));

vi.mock('@/components/chain-selector', () => ({
  ChainSelector: () => <div data-testid="chain-selector" />,
}));

// A valid-looking Stellar public key (G + 55 base32 chars).
const VALID_ADDRESS = 'G' + 'A'.repeat(55);

function setDestinationAddress(value: string) {
  const input = screen.getByLabelText(/your stellar wallet address/i);
  fireEvent.change(input, { target: { value } });
}

describe('ClaimStatusCard', () => {
  // ─── INITIALIZING / PENDING_PAYMENT ────────────────────────────────────

  it('shows a setting-up message for INITIALIZING', () => {
    render(<ClaimStatusCard status={AccountStatus.INITIALIZING} />);
    expect(screen.getByText('Setting up your payment')).toBeInTheDocument();
    expect(screen.getByText(/sender is setting up this payment/i)).toBeInTheDocument();
  });

  it('shows a waiting-for-payment message for PENDING_PAYMENT', () => {
    render(<ClaimStatusCard status={AccountStatus.PENDING_PAYMENT} />);
    expect(screen.getByText('Waiting for payment')).toBeInTheDocument();
    expect(screen.getByText(/payment hasn.t confirmed on-chain yet/i)).toBeInTheDocument();
  });

  // ─── PENDING_CLAIM (AvailablePanel) ────────────────────────────────────

  describe('PENDING_CLAIM', () => {
    it('renders amount, expiry, and memo', () => {
      render(
        <ClaimStatusCard
          status={AccountStatus.PENDING_CLAIM}
          amountStroops="123456789"
          assetCode="XLM"
          expiresAt="2026-08-01T12:00:00Z"
          memo="Thanks!"
        />,
      );
      expect(screen.getByText(/12\.3456789 XLM/)).toBeInTheDocument();
      expect(screen.getByText('Thanks!')).toBeInTheDocument();
    });

    it('renders a dash when amount is missing', () => {
      render(<ClaimStatusCard status={AccountStatus.PENDING_CLAIM} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('disables the claim button until a valid address is entered', () => {
      render(<ClaimStatusCard status={AccountStatus.PENDING_CLAIM} amountStroops="10000000" />);
      const button = screen.getByRole('button', { name: /claim now/i });
      expect(button).toBeDisabled();

      setDestinationAddress('not-a-valid-address');
      expect(button).toBeDisabled();
      expect(screen.getByText(/enter a valid stellar public key/i)).toBeInTheDocument();

      setDestinationAddress(VALID_ADDRESS);
      expect(button).toBeEnabled();
    });

    it('calls onClaim with the destination address and shows success state', async () => {
      const user = userEvent.setup({ delay: null });
      const onClaim = vi.fn().mockResolvedValue(undefined);
      render(
        <ClaimStatusCard
          status={AccountStatus.PENDING_CLAIM}
          amountStroops="10000000"
          onClaim={onClaim}
          sweepNote="stub: sweep pending"
        />,
      );

      setDestinationAddress(VALID_ADDRESS);
      await user.click(screen.getByRole('button', { name: /claim now/i }));

      await waitFor(() => expect(onClaim).toHaveBeenCalledWith(VALID_ADDRESS));
      expect(await screen.findByText(/claim submitted/i)).toBeInTheDocument();
      expect(screen.getByText(/stub: sweep pending/)).toBeInTheDocument();
    });

    it('shows a rate limit banner when onClaim throws RateLimitError', async () => {
      const user = userEvent.setup({ delay: null });
      const onClaim = vi.fn().mockRejectedValue(new RateLimitError(30));
      render(
        <ClaimStatusCard
          status={AccountStatus.PENDING_CLAIM}
          amountStroops="10000000"
          onClaim={onClaim}
        />,
      );

      setDestinationAddress(VALID_ADDRESS);
      await user.click(screen.getByRole('button', { name: /claim now/i }));

      expect(await screen.findByTestId('rate-limit-banner')).toHaveTextContent('retry: 30');
      // Should not show the success state.
      expect(screen.queryByText(/claim submitted/i)).not.toBeInTheDocument();
    });

    it('shows a visible error message for a non-rate-limit rejection', async () => {
      const user = userEvent.setup({ delay: null });
      const onClaim = vi.fn().mockRejectedValue(new Error('boom'));
      render(
        <ClaimStatusCard
          status={AccountStatus.PENDING_CLAIM}
          amountStroops="10000000"
          onClaim={onClaim}
        />,
      );

      setDestinationAddress(VALID_ADDRESS);
      await user.click(screen.getByRole('button', { name: /claim now/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent('boom');
      expect(screen.queryByText(/claim submitted/i)).not.toBeInTheDocument();
    });

    it('clears a previous error on the next claim attempt', async () => {
      const user = userEvent.setup({ delay: null });
      const onClaim = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);
      render(
        <ClaimStatusCard
          status={AccountStatus.PENDING_CLAIM}
          amountStroops="10000000"
          onClaim={onClaim}
        />,
      );

      setDestinationAddress(VALID_ADDRESS);
      const button = screen.getByRole('button', { name: /claim now/i });
      await user.click(button);
      expect(await screen.findByRole('alert')).toBeInTheDocument();

      await user.click(button);
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(await screen.findByText(/claim submitted/i)).toBeInTheDocument();
    });

    it('renders the ChainSelector', () => {
      render(<ClaimStatusCard status={AccountStatus.PENDING_CLAIM} amountStroops="10000000" />);
      expect(screen.getByTestId('chain-selector')).toBeInTheDocument();
    });
  });

  // ─── CLAIMING / PARTIAL_SWEEP ──────────────────────────────────────────

  it('shows a processing message for CLAIMING', () => {
    render(<ClaimStatusCard status={AccountStatus.CLAIMING} />);
    expect(screen.getByText('Claim in progress')).toBeInTheDocument();
    expect(screen.getByText(/being processed on-chain/i)).toBeInTheDocument();
  });

  it('shows a retry hint and sweep note for PARTIAL_SWEEP', () => {
    render(
      <ClaimStatusCard
        status={AccountStatus.PARTIAL_SWEEP}
        sweepNote="stub: 1 of 2 legs complete"
      />,
    );
    expect(screen.getByText('Finishing up your claim')).toBeInTheDocument();
    expect(screen.getByText(/tap claim now to retry/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 legs complete/)).toBeInTheDocument();
  });

  // ─── CLAIMED ────────────────────────────────────────────────────────────

  it('shows the claimed state', () => {
    render(<ClaimStatusCard status={AccountStatus.CLAIMED} />);
    // "Payment already claimed" appears twice (card header + panel body),
    // so scope to the header role instead of a plain text match.
    expect(screen.getByRole('heading', { name: 'Payment already claimed' })).toBeInTheDocument();
    expect(screen.getByText(/transferred to the recipient/i)).toBeInTheDocument();
  });

  // ─── EXPIRED ────────────────────────────────────────────────────────────

  describe('EXPIRED', () => {
    it('shows the expiry date when provided', () => {
      render(<ClaimStatusCard status={AccountStatus.EXPIRED} expiresAt="2026-01-01T00:00:00Z" />);
      expect(screen.getByText('Payment link expired')).toBeInTheDocument();
      expect(screen.getByText(/expired on/i)).toBeInTheDocument();
    });

    it('renders a mailto link when supportEmail is provided', () => {
      render(<ClaimStatusCard status={AccountStatus.EXPIRED} supportEmail="help@example.com" />);
      const link = screen.getByRole('link', { name: 'help@example.com' });
      expect(link).toHaveAttribute('href', 'mailto:help@example.com');
    });

    it('omits the support link when supportEmail is not provided', () => {
      render(<ClaimStatusCard status={AccountStatus.EXPIRED} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  // ─── FAILED ─────────────────────────────────────────────────────────────

  describe('FAILED', () => {
    it('shows the failure message', () => {
      render(<ClaimStatusCard status={AccountStatus.FAILED} />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText(/couldn.t be set up/i)).toBeInTheDocument();
    });

    it('renders a mailto link when supportEmail is provided', () => {
      render(<ClaimStatusCard status={AccountStatus.FAILED} supportEmail="support@example.com" />);
      const link = screen.getByRole('link', { name: 'support@example.com' });
      expect(link).toHaveAttribute('href', 'mailto:support@example.com');
    });

    it('omits the support line when supportEmail is not provided', () => {
      render(<ClaimStatusCard status={AccountStatus.FAILED} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  // ─── General / accessibility ───────────────────────────────────────────

  it('sets an aria-label reflecting the current status', () => {
    render(<ClaimStatusCard status={AccountStatus.CLAIMED} />);
    expect(screen.getByLabelText(`Claim status: ${AccountStatus.CLAIMED}`)).toBeInTheDocument();
  });

  it('renders every AccountStatus value without throwing', () => {
    Object.values(AccountStatus).forEach((status) => {
      const { unmount } = render(<ClaimStatusCard status={status} />);
      unmount();
    });
  });
});
// ─── Recipient instrumentation (#793 / #794 / #824 / #819 / #914) ──────────

describe('ClaimStatusCard analytics', () => {
  beforeEach(() => {
    // `analytics` is a plain object whose methods are looked up at call time,
    // so spying is enough to observe the events without stubbing the module.
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the wallet address screen when the claim is available', () => {
    const spy = vi
      .spyOn(analytics, 'walletAddressScreenViewed')
      .mockImplementation(() => undefined);

    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.PENDING_CLAIM}
        amountStroops="10000000"
      />,
    );

    expect(spy).toHaveBeenCalledWith({ claimId: 'claim_abc', hasPreviousAddress: false });
  });

  it('does not report the address screen for other statuses', () => {
    const spy = vi
      .spyOn(analytics, 'walletAddressScreenViewed')
      .mockImplementation(() => undefined);

    render(<ClaimStatusCard status={AccountStatus.CLAIMED} claimId="claim_abc" />);

    expect(spy).not.toHaveBeenCalled();
  });

  it('reports an entered address when the submission passes validation', async () => {
    const entered = vi
      .spyOn(analytics, 'walletAddressEntered')
      .mockImplementation(() => undefined);

    const user = userEvent.setup({ delay: null });
    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.PENDING_CLAIM}
        amountStroops="10000000"
        onClaim={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    setDestinationAddress(VALID_ADDRESS);
    await user.click(screen.getByRole('button', { name: /claim now/i }));

    expect(entered).toHaveBeenCalledWith({ claimId: 'claim_abc', usedPreviousAddress: false });
  });

  it('reports an invalid address exactly once per editing episode', () => {
    const validationFailed = vi
      .spyOn(analytics, 'walletAddressValidationFailed')
      .mockImplementation(() => undefined);
    const errorDisplayed = vi
      .spyOn(analytics, 'errorDisplayed')
      .mockImplementation(() => undefined);

    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.PENDING_CLAIM}
        amountStroops="10000000"
      />,
    );

    setDestinationAddress('not-a-valid');
    setDestinationAddress('still-not-valid');

    expect(validationFailed).toHaveBeenCalledTimes(1);
    expect(errorDisplayed).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'invalid_wallet_address',
        errorCode: expect.stringContaining('INVALID_ADDRESS_'),
      }),
    );
  });

  it('reports the originating error on a retry rather than a blanket unknown', async () => {
    const retryClicked = vi.spyOn(analytics, 'retryClicked').mockImplementation(() => undefined);
    vi.spyOn(analytics, 'walletAddressEntered').mockImplementation(() => undefined);
    vi.spyOn(analytics, 'errorDisplayed').mockImplementation(() => undefined);

    const user = userEvent.setup({ delay: null });
    const onClaim = vi
      .fn()
      .mockRejectedValueOnce(new ClaimError('SUBMISSION_FAILED_RETRYABLE', 'Try again.', true))
      .mockResolvedValue(undefined);

    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.PENDING_CLAIM}
        amountStroops="10000000"
        onClaim={onClaim}
      />,
    );

    setDestinationAddress(VALID_ADDRESS);
    await user.click(screen.getByRole('button', { name: /claim now/i }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: /claim now/i }));

    expect(retryClicked).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'network_unavailable',
        errorCode: 'SUBMISSION_FAILED_RETRYABLE',
      }),
    );
  });

  it('omits the explorer link when no sweep transaction hash is known', () => {
    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.CLAIMED}
        claimedByMe
        sweepDestination={VALID_ADDRESS}
      />,
    );

    expect(screen.queryByRole('link', { name: /stellar explorer/i })).not.toBeInTheDocument();
  });

  it('renders the explorer link when a transaction hash is known', () => {
    const txHash = 'd'.repeat(64);
    render(
      <ClaimStatusCard
        claimId="claim_abc"
        status={AccountStatus.CLAIMED}
        claimedByMe
        sweepDestination={VALID_ADDRESS}
        sweepTxHash={txHash}
      />,
    );

    expect(screen.getByRole('link', { name: /stellar explorer/i }).getAttribute('href')).toContain(
      txHash,
    );
  });

  it('never puts the claim token in an explorer URL', () => {
    render(
      <ClaimStatusCard
        claimId="tok_secret_claim_token"
        status={AccountStatus.CLAIMED}
        claimedByMe
        sweepDestination={VALID_ADDRESS}
        sweepTxHash={'e'.repeat(64)}
      />,
    );

    expect(
      screen.getByRole('link', { name: /stellar explorer/i }).getAttribute('href'),
    ).not.toContain('tok_secret_claim_token');
  });
});
