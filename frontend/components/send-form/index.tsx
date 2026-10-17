'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectStep } from './steps/connect-step';
import { ExpiryStep } from './steps/expiry-step';
import { DetailsStep } from './steps/details-step';
import { ConfirmStep } from './steps/confirm-step';
import {
  analytics,
  expiryDaysFromHours,
  SEND_FORM_FIELDS,
  type SendFormField,
} from '@/lib/analytics';
import { amountUsdEquiv, getXlmUsdRate } from '@/lib/xlm-price';

export type SendFormStep = 'connect' | 'expiry' | 'details' | 'confirm';

export interface SendFormState {
  publicKey: string;
  expiresInHours: number;
  recipientName: string;
  recipientEmail: string;
  amountXlm: string;
  assetCode: string;
  memo: string;
  expiresIn: number;
}

const INITIAL_STATE: SendFormState = {
  publicKey: '',
  expiresInHours: 24,
  recipientName: '',
  recipientEmail: '',
  amountXlm: '',
  assetCode: 'XLM',
  memo: '',
  expiresIn: 24 * 60 * 60,
};

const STEP_ORDER: SendFormStep[] = ['connect', 'expiry', 'details', 'confirm'];

const STEP_LABELS: Record<SendFormStep, string> = {
  connect: 'Step 1 of 4: Connect Wallet',
  expiry: 'Step 2 of 4: Set Expiry',
  details: 'Step 3 of 4: Set Account Details',
  confirm: 'Step 4 of 4: Create Account',
};

/**
 * Maps a `SendFormState` patch key to the §4.2 `first_field` value.
 *
 * The state keys are camelCase and plural (`amountXlm`, `recipientName`) while
 * the spec's vocabulary is singular snake_case, and the two sets do not
 * line up one-to-one: `recipientEmail` and `publicKey` have no spec
 * counterpart, while `expiration` arrives under a different key than it does
 * on the expiry step.
 */
const FIRST_FIELD_BY_STATE_KEY: Partial<Record<keyof SendFormState, SendFormField>> = {
  amountXlm: SEND_FORM_FIELDS.amount,
  assetCode: SEND_FORM_FIELDS.asset,
  recipientName: SEND_FORM_FIELDS.recipient_name,
  memo: SEND_FORM_FIELDS.message,
  expiresInHours: SEND_FORM_FIELDS.expiration,
};

/**
 * Multi-step send form.
 *
 * Accessibility: when the active step changes, focus is programmatically
 * moved to the step heading so screen reader users hear the new context
 * without having to navigate backwards from wherever focus was left.
 */
export function SendForm() {
  const [step, setStep] = useState<SendFormStep>('connect');
  const [formState, setFormState] = useState<SendFormState>(INITIAL_STATE);
  const [xlmUsdRate, setXlmUsdRate] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // `Send Form Started` must fire exactly once per form view (§4.2), so the
  // "has the sender interacted yet" flag lives in a ref rather than state:
  // it drives no render, and a state update here would re-run the effects
  // below.
  const formStartedRef = useRef(false);

  // Fire on first render of the create-claim form (§4.2 of the analytics spec).
  useEffect(() => {
    analytics.sendFormViewed();
  }, []);

  // The XLM/USD rate is fetched here rather than in each step that needs it:
  // the details step renders it as a hint and the confirm step needs it for
  // §3.2 `amount_usd_equiv`, and `getXlmUsdRate()` caches for 60s.
  useEffect(() => {
    let active = true;
    getXlmUsdRate().then((rate) => {
      if (active) setXlmUsdRate(rate > 0 ? rate : null);
    });
    return () => {
      active = false;
    };
  }, []);

  // Move focus to the step heading every time the step changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    const next = STEP_ORDER[idx + 1];
    if (!next) return;
    if (step === 'details') {
      analytics.sendFormCompleted({
        assetType: formState.assetCode,
        expiryDays: expiryDaysFromHours(formState.expiresInHours),
        amountUsdEquiv: amountUsdEquiv(formState.amountXlm, formState.assetCode, xlmUsdRate),
        hasRecipientName: Boolean(formState.recipientName),
        hasMessage: Boolean(formState.memo),
      });
    }
    setStep(next);
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    const prev = STEP_ORDER[idx - 1];
    if (prev) setStep(prev);
  }

  function updateState(patch: Partial<SendFormState>) {
    // First interaction with any mapped field is §4.2 `Send Form Started`.
    // Every field edit in the form funnels through this function, so this is
    // the one place that can observe "the sender has started filling this in"
    // without each input wiring up its own handler.
    if (!formStartedRef.current) {
      const firstKey = (Object.keys(patch) as (keyof SendFormState)[]).find(
        (key) => FIRST_FIELD_BY_STATE_KEY[key],
      );
      const firstField = firstKey ? FIRST_FIELD_BY_STATE_KEY[firstKey] : undefined;
      if (firstField) {
        formStartedRef.current = true;
        analytics.sendFormStarted({ firstField });
      }
    }

    setFormState((prev) => {
      const next = { ...prev, ...patch };
      // The payload sends `expiresIn` (seconds); the expiry step only edits
      // `expiresInHours`. Keep them in sync so the sender's choice is honoured.
      if (patch.expiresInHours !== undefined) {
        next.expiresIn = Math.round(patch.expiresInHours * 3600);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <nav aria-label="Create ephemeral account progress">
        <ol className="flex gap-2" role="list">
          {STEP_ORDER.map((s, i) => {
            const isCurrent = s === step;
            const isDone = STEP_ORDER.indexOf(step) > i;
            return (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    /
                  </span>
                )}
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`text-xs font-medium ${
                    isCurrent
                      ? 'text-slate-900 dark:text-slate-100'
                      : isDone
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
                  {isDone && <span className="sr-only"> (complete)</span>}
                  {isCurrent && <span className="sr-only"> (current)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step heading — receives focus on every step transition */}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-slate-900 focus:outline-none dark:text-slate-100"
      >
        {STEP_LABELS[step]}
      </h2>

      {/* Step content */}
      {step === 'connect' && (
        <ConnectStep
          publicKey={formState.publicKey}
          onConnected={(key) => {
            updateState({ publicKey: key });
            goNext();
          }}
        />
      )}
      {step === 'expiry' && (
        <ExpiryStep
          expiresInHours={formState.expiresInHours}
          onChange={(hours) => updateState({ expiresInHours: hours })}
          onBack={goBack}
          onNext={goNext}
        />
      )}
      {step === 'details' && (
        <DetailsStep
          state={formState}
          usdRate={xlmUsdRate}
          onChange={updateState}
          onBack={goBack}
          onNext={goNext}
        />
      )}
      {step === 'confirm' && <ConfirmStep state={formState} usdRate={xlmUsdRate} onBack={goBack} />}
    </div>
  );
}
