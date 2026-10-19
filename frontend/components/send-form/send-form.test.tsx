
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendForm } from './index';
import { analytics } from '@/lib/analytics';

// The analytics module is stubbed so these tests assert on what the send form
// asks to be tracked, rather than on provider plumbing that `lib/analytics.ts`
// covers in its own suite. `importOriginal` keeps the real helpers the form
// also imports (expiryDaysFromHours, SEND_FORM_FIELDS, amountUsdEquiv).
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    analytics: {
      ...actual.analytics,
      sendFormViewed: vi.fn(),
      sendFormStarted: vi.fn(),
      sendFormCompleted: vi.fn(),
    },
  };
});

// Keep the form's XLM/USD lookup offline; the real one calls CoinGecko.
vi.mock('@/lib/xlm-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xlm-price')>();
  return { ...actual, getXlmUsdRate: vi.fn().mockResolvedValue(0.25) };
});

// ── Step component stubs ─────────────────────────────────────────────────────

vi.mock('./steps/connect-step', () => ({
  ConnectStep: ({ onConnected }: { onConnected: (key: string) => void }) => (
    <div>
      <span>Connect step</span>
      <button onClick={() => onConnected('G' + 'A'.repeat(55))}>Mock Connect</button>
    </div>
  ),
}));

vi.mock('./steps/expiry-step', () => ({
  ExpiryStep: ({ onBack, onNext }: { onBack: () => void; onNext: () => void }) => (
    <div>
      <span>Expiry step</span>
      <button onClick={onBack}>Back</button>
      <button onClick={onNext}>Continue</button>
    </div>
  ),
}));

vi.mock('./steps/details-step', () => ({
  DetailsStep: ({
    onChange,
    onBack,
    onNext,
  }: {
    onChange: (patch: Record<string, unknown>) => void;
    onBack: () => void;
    onNext: () => void;
  }) => (
    <div>
      <span>Details step</span>
      <button onClick={onBack}>Back</button>
      <button onClick={() => onChange({ amountXlm: '5' })}>Mock Edit Amount</button>
      <button onClick={() => onChange({ recipientName: 'Amina' })}>Mock Edit Name</button>
      <button onClick={onNext}>Continue</button>
    </div>
  ),
}));

vi.mock('./steps/confirm-step', () => ({
  ConfirmStep: ({ onBack }: { onBack: () => void; usdRate?: number | null }) => (
    <div>
      <span>Confirm step</span>
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

// ── Analytics mock ──────────────────────────────────────────────────────────

vi.mock('@/lib/analytics', () => ({
  analytics: {
    sendFormViewed: vi.fn(),
    sendFormCompleted: vi.fn(),
  },
}));

describe('SendForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial render ─────────────────────────────────────────────────────────

  it('starts on the connect step with the correct heading', () => {
    render(<SendForm />);
    expect(screen.getByText('Connect step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /step 1 of 4/i })).toBeInTheDocument();
  });

  it('renders the step breadcrumb nav with 4 items', () => {
    render(<SendForm />);
    expect(
      screen.getByRole('navigation', { name: /create ephemeral account progress/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('marks only the current step with aria-current="step"', () => {
    render(<SendForm />);
    // sr-only "(current)" appears exactly once
    expect(screen.getAllByText(/\(current\)/)).toHaveLength(1);
  });

  // ── Forward navigation ─────────────────────────────────────────────────────

  it('advances to expiry when wallet is connected', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));

    expect(screen.getByText('Expiry step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /step 2 of 4/i })).toBeInTheDocument();
  });

  it('advances to details after expiry Continue', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Details step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /step 3 of 4/i })).toBeInTheDocument();
  });

  it('advances to confirm after details Continue', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' })); // expiry
    await user.click(screen.getByRole('button', { name: 'Continue' })); // details

    expect(screen.getByText('Confirm step')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /step 4 of 4/i })).toBeInTheDocument();
  });

  // ── Back navigation ────────────────────────────────────────────────────────

  it('goes back from expiry to connect', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Connect step')).toBeInTheDocument();
  });

  it('goes back from details to expiry', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Expiry step')).toBeInTheDocument();
  });

  it('goes back from confirm to details', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Details step')).toBeInTheDocument();
  });

  // ── Breadcrumb state ───────────────────────────────────────────────────────

  it('marks completed steps with sr-only "(complete)" after advancing', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    // Step 1 (Connect) is now done
    expect(screen.getAllByText(/\(complete\)/)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // Steps 1 and 2 are done
    expect(screen.getAllByText(/\(complete\)/)).toHaveLength(2);
  });

  // ── Focus management ───────────────────────────────────────────────────────

  it('moves focus to the step heading when the step changes', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));

    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: /step 2 of 4/i });
      expect(document.activeElement).toBe(heading);
    });
  });
  // ── Send Form Started (#773) ────────────────────────────────────────────────

  it('fires Send Form Started once, naming the first field the sender touched', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Mock Edit Amount' }));

    expect(analytics.sendFormStarted).toHaveBeenCalledTimes(1);
    expect(analytics.sendFormStarted).toHaveBeenCalledWith({ firstField: 'amount' });
  });

  it('does not fire Send Form Started again for a later field', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Mock Edit Name' }));
    await user.click(screen.getByRole('button', { name: 'Mock Edit Amount' }));

    expect(analytics.sendFormStarted).toHaveBeenCalledTimes(1);
    expect(analytics.sendFormStarted).toHaveBeenCalledWith({ firstField: 'recipient_name' });
  });

  it('does not fire Send Form Started when the wallet connects without a field edit', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));

    expect(analytics.sendFormStarted).not.toHaveBeenCalled();
  });

  // ── Send Form Completed (#816 / #817 / #818) ─────────────────────────────────

  it('reports expiry_days and amount_usd_equiv on Send Form Completed', async () => {
    const user = userEvent.setup();
    render(<SendForm />);

    // The form fetches the XLM/USD rate on mount; let it settle so the
    // completion payload is not asserted against a not-yet-loaded rate.
    await act(async () => {
      await Promise.resolve();
    });

    await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Mock Edit Amount' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(analytics.sendFormCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        // 24h is the expiry step's default and is a whole 1-day window.
        expiryDays: 1,
        // 5 XLM at the stubbed 0.25 USD rate.
        amountUsdEquiv: 1.25,
      }),
    );
  });


  // ── Analytics (#772) ──────────────────────────────────────────────────────

  describe('Send Form Viewed (spec 4.2, issue #772)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('fires analytics.sendFormViewed exactly once when the form is displayed', () => {
      render(<SendForm />);

      expect(analytics.sendFormViewed).toHaveBeenCalledTimes(1);
    });

    it('does not re-fire sendFormViewed on step transitions', async () => {
      const user = userEvent.setup();
      render(<SendForm />);

      await user.click(screen.getByRole('button', { name: 'Mock Connect' }));
      await user.click(screen.getByRole('button', { name: 'Continue' })); // expiry
      await user.click(screen.getByRole('button', { name: 'Continue' })); // details
      await user.click(screen.getByRole('button', { name: 'Back' })); // back to details

      expect(screen.getByText('Details step')).toBeInTheDocument();
      expect(analytics.sendFormViewed).toHaveBeenCalledTimes(1);
    });
  });
});
