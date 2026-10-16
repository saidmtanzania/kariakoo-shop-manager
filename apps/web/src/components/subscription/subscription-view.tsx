'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PAYMENT_LIMITS,
  PLAN_FEATURES,
  type PaymentStatus,
  type PaymentView,
  type PlanView,
  type SessionInfo,
  type SubscriptionView as Subscription,
} from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { can, errorKey, SESSION_KEY, useSession } from '@/lib/session';

const SUBSCRIPTION_KEY = ['subscription'] as const;

const LIMIT_FEATURES: ReadonlySet<string> = new Set(
  PLAN_FEATURES.filter((f) => f.kind === 'limit').map((f) => f.key),
);

const STATUS_VARIANT: Record<
  Subscription['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  TRIALING: 'secondary',
  ACTIVE: 'default',
  GRACE: 'outline',
  RESTRICTED: 'destructive',
};

const PAYMENT_VARIANT: Record<
  PaymentStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING: 'outline',
  CONFIRMED: 'default',
  FAILED: 'destructive',
  REVERSED: 'destructive',
};

/** The shop's plan, status, payments and the manual payment form. */
export function SubscriptionView() {
  const t = useTranslations('Subscription');
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.data === null) router.replace('/login?next=/subscription');
    else if (session.data && !session.data.activeShopId) router.replace('/');
  }, [session.data, router]);

  if (!session.data?.activeShopId) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('loading')}
      </p>
    );
  }
  const info = session.data;

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">{t('back')}</Link>
        </Button>
      </header>
      {can(info, 'subscription.read') ? (
        <Details info={info} />
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function Details({ info }: { info: SessionInfo }) {
  const t = useTranslations('Subscription');
  const sub = useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: ({ signal }) =>
      apiFetch<Subscription>('/shops/current/subscription', { signal }),
  });
  if (sub.isError) {
    return <Alert variant="destructive">{t('loadFailed')}</Alert>;
  }
  if (!sub.data) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('loading')}
      </p>
    );
  }
  return (
    <>
      <StatusCard sub={sub.data} />
      {can(info, 'subscription.manage') ? <PayCard sub={sub.data} /> : null}
      <HistoryCard payments={sub.data.payments} />
    </>
  );
}

function StatusCard({ sub }: { sub: Subscription }) {
  const t = useTranslations('Subscription');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'long' });
  const featureKeys = Object.keys(
    sub.features,
  ) as (keyof Subscription['features'])[];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            <h2 className="text-lg font-semibold">
              {sub.plan?.name ?? t('freeTrial')}
            </h2>
          </CardTitle>
          <Badge
            variant={STATUS_VARIANT[sub.status]}
            data-testid="subscription-status"
          >
            {t(`status.${sub.status}`)}
          </Badge>
        </div>
        <CardDescription>{t(`explain.${sub.status}`)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('trialEnds')}</dt>
          <dd>{day(sub.trialEndsAt)}</dd>
          {sub.paidUntil ? (
            <>
              <dt className="text-muted-foreground">{t('paidUntil')}</dt>
              <dd data-testid="paid-until">{day(sub.paidUntil)}</dd>
            </>
          ) : null}
          {sub.status === 'GRACE' && sub.graceEndsAt ? (
            <>
              <dt className="text-muted-foreground">{t('graceEnds')}</dt>
              <dd>{day(sub.graceEndsAt)}</dd>
            </>
          ) : null}
        </dl>
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('included')}</h3>
          <ul className="grid gap-1 text-sm">
            {featureKeys.map((k) => {
              const f = sub.features[k];
              return (
                <li key={k} className="flex justify-between gap-4">
                  <span>{t(`features.${k}`)}</span>
                  <span className="text-muted-foreground">
                    {!f.enabled
                      ? t('notIncluded')
                      : f.limit !== null
                        ? t('upTo', { count: f.limit })
                        : LIMIT_FEATURES.has(k)
                          ? t('unlimited')
                          : t('yes')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function PayCard({ sub }: { sub: Subscription }) {
  const t = useTranslations('Subscription');
  const tErr = useTranslations('Errors');
  const queryClient = useQueryClient();
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: ({ signal }) =>
      apiFetch<{ plans: PlanView[] }>('/plans', { signal }),
  });
  const [planId, setPlanId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  // One key per attempt: a retry after a lost response cannot pay twice.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const list = plans.data?.plans ?? [];
  const selected = list.find((p) => p.id === planId) ?? list[0];
  const waiting = sub.payments.some((p) => p.status === 'PENDING');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const ref = reference.trim();
    if (
      ref.length < PAYMENT_LIMITS.referenceMin ||
      !/^[A-Za-z0-9.\-_/]+$/.test(ref)
    ) {
      setFieldError(t('referenceInvalid'));
      return;
    }
    if (!selected) return;
    setPending(true);
    try {
      await apiFetch('/shops/current/subscription/payments', {
        method: 'POST',
        body: {
          planId: selected.id,
          reference: ref,
          payerPhone: phone.trim() || undefined,
          idempotencyKey,
        },
      });
      setSubmitted(true);
      setReference('');
      setIdempotencyKey(newKey());
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setPending(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
      ]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('payTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('payDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {submitted || waiting ? (
          <Alert data-testid="payment-waiting">{t('waiting')}</Alert>
        ) : null}
        {plans.isSuccess && list.length === 0 ? (
          <Alert>{t('noPlans')}</Alert>
        ) : null}
        {list.length > 0 ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => void submit(e)}
            noValidate
          >
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                {t('choosePlan')}
              </legend>
              {list.map((p) => (
                <label
                  key={p.id}
                  htmlFor={`plan-${p.id}`}
                  className="flex min-h-12 items-center gap-3 rounded-md border px-3"
                >
                  <input
                    id={`plan-${p.id}`}
                    type="radio"
                    name="plan"
                    className="size-4"
                    checked={selected?.id === p.id}
                    onChange={() => setPlanId(p.id)}
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-sm font-medium">
                    {t(`per.${p.interval}`, {
                      price: formatMoney(p.price, p.currency),
                    })}
                  </span>
                </label>
              ))}
            </fieldset>
            {sub.paymentInstructions ? (
              <div
                className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap"
                data-testid="payment-instructions"
              >
                {sub.paymentInstructions}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t('noInstructions')}
              </p>
            )}
            {selected ? (
              <p className="text-sm">
                {t('amountToPay', {
                  amount: formatMoney(selected.price, selected.currency),
                })}
              </p>
            ) : null}
            <Field
              id="payment-reference"
              label={t('reference')}
              value={reference}
              maxLength={PAYMENT_LIMITS.referenceMax}
              autoComplete="off"
              onChange={(e) => setReference(e.target.value)}
              error={fieldError ?? undefined}
              placeholder={t('referencePlaceholder')}
            />
            <Field
              id="payment-phone"
              label={t('payerPhone')}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
            <Button type="submit" disabled={pending}>
              {pending ? t('sending') : t('submitPayment')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('manualNote')}</p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HistoryCard({ payments }: { payments: PaymentView[] }) {
  const t = useTranslations('Subscription');
  const format = useFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium' });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('history')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPayments')}</p>
        ) : (
          <ul className="grid divide-y" data-testid="payment-history">
            {payments.map((p) => (
              <li
                key={p.id}
                className="grid gap-1 py-3 text-sm"
                data-testid={`payment-${p.reference}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.planName} · {formatMoney(p.amount, p.currency)}
                  </span>
                  <Badge variant={PAYMENT_VARIANT[p.status]}>
                    {t(`paymentStatus.${p.status}`)}
                  </Badge>
                </div>
                <span className="text-muted-foreground">
                  {t('paymentLine', {
                    date: day(p.createdAt),
                    reference: p.reference,
                  })}
                </span>
                {p.period ? (
                  <span className="text-muted-foreground">
                    {t(p.period.reversed ? 'periodReversed' : 'period', {
                      start: day(p.period.start),
                      end: day(p.period.end),
                    })}
                  </span>
                ) : null}
                {p.note && p.status !== 'CONFIRMED' ? (
                  <span className="text-muted-foreground">{p.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
