'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  billingSettingsSchema,
  PLAN_FEATURES,
  planCreateSchema,
  type BillingSettingsView,
  type FeatureKey,
  type PlanView,
  type PlatformPaymentView,
} from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { errorKey, useSession } from '@/lib/session';

const PLATFORM_KEY = ['platform'] as const;

/** Platform staff: payments to check, plans and billing settings. */
export function PlatformView() {
  const t = useTranslations('Platform');
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.data === null) router.replace('/login?next=/platform');
  }, [session.data, router]);

  if (!session.data) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('loading')}
      </p>
    );
  }
  return (
    <div className="grid w-full max-w-3xl gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">{t('back')}</Link>
        </Button>
      </header>
      {session.data.user.isPlatformAdmin ? (
        <>
          <PaymentsSection />
          <PlansSection />
          <SettingsSection />
        </>
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            <h2 className="text-lg font-semibold">{title}</h2>
          </CardTitle>
          {action}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-3">{children}</CardContent>
    </Card>
  );
}

function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setPending(true);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorKey(err));
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: PLATFORM_KEY });
      setPending(false);
    }
  };
  return { run, error, pending };
}

function ErrorAlert({ code }: { code: string | null }) {
  const t = useTranslations('Errors');
  return code ? <Alert variant="destructive">{t(code)}</Alert> : null;
}

// ---- Payments ----

function PaymentsSection() {
  const t = useTranslations('Platform');
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const payments = useQuery({
    queryKey: [...PLATFORM_KEY, 'payments', filter],
    queryFn: ({ signal }) =>
      apiFetch<{ payments: PlatformPaymentView[] }>(
        `/platform/payments?filter=${filter}`,
        { signal },
      ),
  });
  const list = payments.data?.payments ?? [];
  return (
    <Section
      title={t('payments')}
      description={t('paymentsDescription')}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setFilter(filter === 'attention' ? 'all' : 'attention')
          }
        >
          {filter === 'attention' ? t('showAll') : t('showAttention')}
        </Button>
      }
    >
      {payments.isSuccess && list.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noPayments')}</p>
      ) : null}
      <ul className="grid divide-y" data-testid="platform-payments">
        {list.map((p) => (
          <PaymentRow key={p.id} payment={p} />
        ))}
      </ul>
    </Section>
  );
}

function PaymentRow({ payment: p }: { payment: PlatformPaymentView }) {
  const t = useTranslations('Platform');
  const tSub = useTranslations('Subscription');
  const format = useFormatter();
  const { run, error, pending } = useAction();
  const [note, setNote] = useState('');
  const decide = (action: 'confirm' | 'reject' | 'reverse') =>
    void run(() =>
      apiFetch(`/platform/payments/${p.id}/${action}`, {
        method: 'POST',
        body: note.trim() ? { note: note.trim() } : {},
      }),
    );
  const open =
    p.status === 'PENDING' || (p.status === 'FAILED' && p.needsReview);

  return (
    <li
      className="grid gap-2 py-3 text-sm"
      data-testid={`platform-payment-${p.reference}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {p.shopName} · {p.planName} · {formatMoney(p.amount, p.currency)}
        </span>
        <span className="flex gap-1">
          {p.needsReview ? (
            <Badge variant="destructive">{t('needsReview')}</Badge>
          ) : null}
          <Badge variant="secondary">{tSub(`paymentStatus.${p.status}`)}</Badge>
        </span>
      </div>
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4">
        <dt>{t('reference')}</dt>
        <dd className="text-foreground font-mono">{p.reference}</dd>
        <dt>{t('method')}</dt>
        <dd>{p.provider}</dd>
        {p.payerPhone ? (
          <>
            <dt>{t('phone')}</dt>
            <dd>{p.payerPhone}</dd>
          </>
        ) : null}
        <dt>{t('submitted')}</dt>
        <dd>
          {format.dateTime(new Date(p.createdAt), {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </dd>
        {p.note ? (
          <>
            <dt>{t('note')}</dt>
            <dd>{p.note}</dd>
          </>
        ) : null}
      </dl>
      <ErrorAlert code={error} />
      {open || p.status === 'CONFIRMED' ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-48 flex-1 gap-1">
            <Label htmlFor={`note-${p.id}`}>{t('decisionNote')}</Label>
            <Input
              id={`note-${p.id}`}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {open ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => decide('confirm')}
              >
                {t('confirm')}
              </Button>
              {p.status === 'PENDING' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => decide('reject')}
                >
                  {t('reject')}
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => decide('reverse')}
            >
              {t('reverse')}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

// ---- Plans ----

interface PlanForm {
  code: string;
  name: string;
  interval: 'WEEK' | 'MONTH';
  price: string;
  graceDays: string;
  sortOrder: string;
  active: boolean;
  /** Limit features: '' = unlimited; switch features: 'on' or ''. */
  features: Record<FeatureKey, { enabled: boolean; limit: string }>;
}

function emptyForm(): PlanForm {
  const features = {} as PlanForm['features'];
  for (const f of PLAN_FEATURES) features[f.key] = { enabled: true, limit: '' };
  return {
    code: '',
    name: '',
    interval: 'MONTH',
    price: '',
    graceDays: '3',
    sortOrder: '0',
    active: true,
    features,
  };
}

function formFromPlan(plan: PlanView): PlanForm {
  const form = emptyForm();
  for (const f of PLAN_FEATURES) {
    const row = plan.features.find((x) => x.featureKey === f.key);
    form.features[f.key] = {
      enabled: Boolean(row?.enabled),
      limit:
        row?.limitValue === null || row?.limitValue === undefined
          ? ''
          : String(row.limitValue),
    };
  }
  return {
    ...form,
    code: plan.code,
    name: plan.name,
    interval: plan.interval,
    price: plan.price,
    graceDays: String(plan.graceDays),
    sortOrder: String(plan.sortOrder),
    active: plan.active,
  };
}

function toBody(form: PlanForm) {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    interval: form.interval,
    price: form.price.trim(),
    graceDays: Number(form.graceDays),
    sortOrder: Number(form.sortOrder),
    active: form.active,
    features: PLAN_FEATURES.map((f) => ({
      featureKey: f.key,
      enabled: form.features[f.key].enabled,
      limitValue:
        f.kind === 'limit' && form.features[f.key].limit.trim() !== ''
          ? Number(form.features[f.key].limit)
          : null,
    })),
  };
}

function PlansSection() {
  const t = useTranslations('Platform');
  const plans = useQuery({
    queryKey: [...PLATFORM_KEY, 'plans'],
    queryFn: ({ signal }) =>
      apiFetch<{ plans: PlanView[] }>('/platform/plans', { signal }),
  });
  const [creating, setCreating] = useState(false);
  const list = plans.data?.plans ?? [];
  return (
    <Section
      title={t('plans')}
      description={t('plansDescription')}
      action={
        creating ? null : (
          <Button size="sm" onClick={() => setCreating(true)}>
            {t('newPlan')}
          </Button>
        )
      }
    >
      {creating ? <PlanEditor onDone={() => setCreating(false)} /> : null}
      {plans.isSuccess && list.length === 0 && !creating ? (
        <p className="text-muted-foreground text-sm">{t('noPlans')}</p>
      ) : null}
      <ul className="grid divide-y" data-testid="platform-plans">
        {list.map((p) => (
          <PlanRow key={p.id} plan={p} />
        ))}
      </ul>
    </Section>
  );
}

function PlanRow({ plan }: { plan: PlanView }) {
  const t = useTranslations('Platform');
  const tSub = useTranslations('Subscription');
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <li className="py-3">
        <PlanEditor plan={plan} onDone={() => setEditing(false)} />
      </li>
    );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <span>
        <span className="font-medium">{plan.name}</span>{' '}
        <span className="text-muted-foreground">
          ({plan.code}) ·{' '}
          {tSub(`per.${plan.interval}`, {
            price: formatMoney(plan.price, plan.currency),
          })}
        </span>{' '}
        {plan.active ? null : <Badge variant="outline">{t('inactive')}</Badge>}
      </span>
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        {t('edit')}
      </Button>
    </li>
  );
}

function PlanEditor({ plan, onDone }: { plan?: PlanView; onDone: () => void }) {
  const t = useTranslations('Platform');
  const tSub = useTranslations('Subscription');
  const { run, error, pending } = useAction();
  const [form, setForm] = useState<PlanForm>(() =>
    plan ? formFromPlan(plan) : emptyForm(),
  );
  const [invalid, setInvalid] = useState(false);
  const set = (patch: Partial<PlanForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const setFeature = (
    key: FeatureKey,
    patch: Partial<PlanForm['features'][FeatureKey]>,
  ) =>
    setForm((f) => ({
      ...f,
      features: { ...f.features, [key]: { ...f.features[key], ...patch } },
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = toBody(form);
    const parsed = planCreateSchema.safeParse(
      plan ? { ...body, code: plan.code, interval: plan.interval } : body,
    );
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    const ok = await run(() =>
      plan
        ? apiFetch(`/platform/plans/${plan.id}`, {
            method: 'PATCH',
            body: {
              name: body.name,
              price: body.price,
              graceDays: body.graceDays,
              sortOrder: body.sortOrder,
              active: body.active,
              features: body.features,
            },
          })
        : apiFetch('/platform/plans', { method: 'POST', body }),
    );
    if (ok) onDone();
  };

  return (
    <form
      className="grid gap-3 rounded-md border p-3"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      {plan ? null : (
        <Field
          id="plan-code"
          label={t('code')}
          value={form.code}
          onChange={(e) => set({ code: e.target.value })}
        />
      )}
      <Field
        id={`plan-name-${plan?.id ?? 'new'}`}
        label={t('name')}
        value={form.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      {plan ? null : (
        <div className="grid gap-2">
          <Label htmlFor="plan-interval">{t('interval')}</Label>
          <select
            id="plan-interval"
            className="border-input h-10 rounded-md border bg-transparent px-3 text-base md:text-sm"
            value={form.interval}
            onChange={(e) =>
              set({ interval: e.target.value as PlanForm['interval'] })
            }
          >
            <option value="WEEK">{t('weekly')}</option>
            <option value="MONTH">{t('monthly')}</option>
          </select>
        </div>
      )}
      <Field
        id={`plan-price-${plan?.id ?? 'new'}`}
        label={t('price')}
        inputMode="decimal"
        value={form.price}
        onChange={(e) => set({ price: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id={`plan-grace-${plan?.id ?? 'new'}`}
          label={t('graceDays')}
          type="number"
          min={0}
          max={60}
          value={form.graceDays}
          onChange={(e) => set({ graceDays: e.target.value })}
        />
        <Field
          id={`plan-order-${plan?.id ?? 'new'}`}
          label={t('sortOrder')}
          type="number"
          min={0}
          value={form.sortOrder}
          onChange={(e) => set({ sortOrder: e.target.value })}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('features')}</legend>
        {PLAN_FEATURES.map((f) => (
          <div
            key={f.key}
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <label
              className="flex min-h-8 flex-1 items-center gap-2"
              htmlFor={`feat-${plan?.id ?? 'new'}-${f.key}`}
            >
              <input
                id={`feat-${plan?.id ?? 'new'}-${f.key}`}
                type="checkbox"
                className="size-4"
                checked={form.features[f.key].enabled}
                onChange={(e) =>
                  setFeature(f.key, { enabled: e.target.checked })
                }
              />
              {tSub(`features.${f.key}`)}
            </label>
            {f.kind === 'limit' ? (
              <Input
                aria-label={t('limitFor', {
                  feature: tSub(`features.${f.key}`),
                })}
                className="w-32"
                type="number"
                min={0}
                placeholder={t('unlimited')}
                value={form.features[f.key].limit}
                disabled={!form.features[f.key].enabled}
                onChange={(e) => setFeature(f.key, { limit: e.target.value })}
              />
            ) : null}
          </div>
        ))}
      </fieldset>
      <label
        className="flex min-h-8 items-center gap-2 text-sm"
        htmlFor={`plan-active-${plan?.id ?? 'new'}`}
      >
        <input
          id={`plan-active-${plan?.id ?? 'new'}`}
          type="checkbox"
          className="size-4"
          checked={form.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
        {t('activeLabel')}
      </label>
      {invalid ? <Alert variant="destructive">{t('planInvalid')}</Alert> : null}
      <ErrorAlert code={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

// ---- Billing settings ----

function SettingsSection() {
  const t = useTranslations('Platform');
  const settings = useQuery({
    queryKey: [...PLATFORM_KEY, 'settings'],
    queryFn: ({ signal }) =>
      apiFetch<BillingSettingsView>('/platform/billing-settings', { signal }),
  });
  return (
    <Section title={t('settings')} description={t('settingsDescription')}>
      {settings.data ? <SettingsForm initial={settings.data} /> : null}
    </Section>
  );
}

function SettingsForm({ initial }: { initial: BillingSettingsView }) {
  const t = useTranslations('Platform');
  const { run, error, pending } = useAction();
  const [trialDays, setTrialDays] = useState(String(initial.trialDays));
  const [reminderDays, setReminderDays] = useState(
    String(initial.reminderDaysBefore),
  );
  const [instructions, setInstructions] = useState(
    initial.paymentInstructions ?? '',
  );
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const body = {
      trialDays: Number(trialDays),
      reminderDaysBefore: Number(reminderDays),
      paymentInstructions: instructions.trim() || null,
    };
    const parsed = billingSettingsSchema.safeParse(body);
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    setSaved(
      await run(() =>
        apiFetch('/platform/billing-settings', { method: 'PUT', body }),
      ),
    );
  };

  return (
    <form className="grid gap-3" onSubmit={(e) => void submit(e)} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="trial-days"
          label={t('trialDays')}
          type="number"
          min={0}
          max={90}
          value={trialDays}
          onChange={(e) => setTrialDays(e.target.value)}
        />
        <Field
          id="reminder-days"
          label={t('reminderDays')}
          type="number"
          min={0}
          max={30}
          value={reminderDays}
          onChange={(e) => setReminderDays(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="payment-instructions">{t('instructions')}</Label>
        <textarea
          id="payment-instructions"
          className="border-input min-h-24 rounded-md border bg-transparent px-3 py-2 text-base md:text-sm"
          maxLength={1000}
          value={instructions}
          placeholder={t('instructionsPlaceholder')}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>
      {invalid ? (
        <Alert variant="destructive">{t('settingsInvalid')}</Alert>
      ) : null}
      {saved ? <Alert>{t('saved')}</Alert> : null}
      <ErrorAlert code={error} />
      <Button type="submit" disabled={pending}>
        {t('save')}
      </Button>
    </form>
  );
}
