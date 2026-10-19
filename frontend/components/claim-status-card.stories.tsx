import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite';
import { AccountStatus } from '@/lib/api/types';
import { initAnalyticsMock, resetPlausibleMock } from '@/mocks/plausible';
import { ClaimStatusCard } from './claim-status-card';

/**
 * Stories for the claim card, including every state it can render and the
 * analytics-instrumented surfaces on it.
 *
 * Two things worth knowing when reading these:
 *
 * 1. **Dark mode is class-based**, not a media query — `app/globals.css`
 *    declares `@custom-variant dark (&:where(.dark, .dark *))` so the theme
 *    toggle can flip it. A `decorators.dark` wrapper sets that class, which is
 *    why these stories can force dark mode without touching browser settings.
 * 2. **Every story mounts with the mock analytics sink installed**
 *    (`mocks/plausible.ts`), so the tracking calls the card makes can be
 *    confirmed from the story panel without any network traffic. The recorded
 *    events are listed in the story description below the canvas.
 */

// Installed once at module load rather than inside the decorator: the mock is
// idempotent, and doing it in render would re-run on every re-render. Stories
// are excluded from `tsconfig.json` and never reach a production bundle.
resetPlausibleMock();
initAnalyticsMock();

const withAnalyticsMock: Decorator = (Story) => <Story />;

/** Forces the `.dark` class on the story subtree, matching the real theme toggle. */
const dark: Decorator = (Story) => (
  <div className="dark bg-slate-950 p-4">
    <Story />
  </div>
);

const meta: Meta<typeof ClaimStatusCard> = {
  title: 'Components/ClaimStatusCard',
  component: ClaimStatusCard,
  tags: ['autodocs'],
  decorators: [withAnalyticsMock],
};

export default meta;

type Story = StoryObj<typeof ClaimStatusCard>;

const unclaimedArgs = {
  status: AccountStatus.PENDING_CLAIM,
  claimId: 'claim_story_1',
  amountStroops: '1000000000',
  assetCode: 'USDC',
  expiresAt: '2026-07-15T12:00:00Z',
};

export const Initializing: Story = {
  args: { status: AccountStatus.INITIALIZING },
};

export const PendingPayment: Story = {
  args: { status: AccountStatus.PENDING_PAYMENT },
};

export const Unclaimed: Story = {
  args: unclaimedArgs,
};

/**
 * The ready-to-claim form. Mounting it fires §5.2 `Wallet Address Screen
 * Viewed`; typing a malformed address fires §6 `Error Displayed` with
 * `error_type: "invalid_wallet_address"` (§5.2 `Wallet Address Validation
 * Failed`); submitting fires §5.2 `Wallet Address Entered`.
 *
 * Use this story to check the contrast of the label, the typed address, the
 * placeholder and the amount in both themes — the amount was previously
 * invisible in dark mode.
 */
export const ReadyToClaim: Story = {
  args: unclaimedArgs,
  parameters: {
    docs: {
      description: {
        story:
          'Fires on mount: `Wallet Address Screen Viewed`. On an invalid address: `Wallet Address Validation Failed` + `Error Displayed` (invalid_wallet_address). On a valid submit: `Wallet Address Entered`.',
      },
    },
  },
};

export const ReadyToClaimDark: Story = {
  args: unclaimedArgs,
  decorators: [dark],
  parameters: {
    docs: {
      description: {
        story:
          'Same component, forced dark. Verify: label and typed address meet 4.5:1, the amount and the "—" placeholder are legible, and the focused input shows one tight ring rather than a doubled outline.',
      },
    },
  },
};

export const ClaimedByThisSession: Story = {
  args: {
    status: AccountStatus.CLAIMED,
    claimId: 'claim_story_1',
    claimedByMe: true,
    sweepDestination: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Fires on mount: §5.4 `Claim Success Viewed`. The explorer link appears only when `sweepTxHash` is supplied.',
      },
    },
  },
};

export const ClaimedBySomeoneElse: Story = {
  args: {
    status: AccountStatus.CLAIMED,
    claimId: 'claim_story_1',
    claimedByMe: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Renders "Payment already claimed". The page-load path reports §6 `Error Displayed` with `error_type: "already_claimed"`.',
      },
    },
  },
};

export const Processing: Story = {
  args: { status: AccountStatus.CLAIMING },
};

export const PartialSweep: Story = {
  args: {
    status: AccountStatus.PARTIAL_SWEEP,
    sweepNote: 'Sweep retried after a transient network failure.',
  },
};

export const Expired: Story = {
  args: {
    status: AccountStatus.EXPIRED,
    expiresAt: '2026-06-01T00:00:00Z',
    supportEmail: 'support@bridgelet.com',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Renders the expiry panel. The page-load path reports §6 `Error Displayed` with `error_type: "expired_token"`.',
      },
    },
  },
};

export const Failed: Story = {
  args: { status: AccountStatus.FAILED, supportEmail: 'support@bridgelet.com' },
  parameters: {
    docs: {
      description: {
        story:
          'Unclassified load failure — §6 `Error Displayed` with `error_type: "unknown"` and `error_code: "CLAIM_LOAD_FAILED"`.',
      },
    },
  },
};

/** Every non-mutating state, for a quick visual regression sweep. */
export const AllStates: Story = {
  render: () => (
    <div className="space-y-4">
      <ClaimStatusCard status={AccountStatus.INITIALIZING} />
      <ClaimStatusCard status={AccountStatus.PENDING_PAYMENT} />
      <ClaimStatusCard {...unclaimedArgs} />
      <ClaimStatusCard status={AccountStatus.CLAIMING} />
      <ClaimStatusCard status={AccountStatus.CLAIMED} />
      <ClaimStatusCard status={AccountStatus.EXPIRED} expiresAt="2026-06-01T00:00:00Z" />
      <ClaimStatusCard status={AccountStatus.FAILED} />
    </div>
  ),
};

export const AllStatesDark: Story = {
  ...AllStates,
  decorators: [dark],
  parameters: {
    docs: {
      description: {
        story: 'The same sweep with the `.dark` class forced on the subtree.',
      },
    },
  },
};