'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseDetail, SessionInfo } from '@ksm/shared';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/forms/field';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { formatQuantity } from '@/lib/quantity';
import { can, errorKey, KNOWN_ERRORS } from '@/lib/session';
import {
  emptyPayment,
  money,
  paymentBody,
  PaymentFields,
  StatusBadge,
  type PaymentInputState,
} from './common';

/** "1850.0000" → "1850", "1930.5000" → "1930.5". */
const trimZeros = (v: string) =>
  v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;

/** The detail page reads the purchase id from the URL. */
export function PurchaseDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const receiveError = useSearchParams().get('receiveError');
  return (
    <PurchaseDetailView
      purchaseId={id}
      receiveError={
        receiveError && KNOWN_ERRORS.has(receiveError)
          ? receiveError
          : receiveError
            ? 'generic'
            : null
      }
    />
  );
}

export function PurchaseDetailView({
  purchaseId,
  receiveError,
}: {
  purchaseId: string;
  receiveError: string | null;
}) {
  const t = useTranslations('Purchases');
  const tErr = useTranslations('Errors');
  const format = useFormatter();
  const info = useShopSession(`/purchases/${purchaseId}`);
  const purchase = useQuery({
    queryKey: ['purchase', purchaseId],
    queryFn: ({ signal }) =>
      apiFetch<PurchaseDetail>(`/shops/current/purchases/${purchaseId}`, {
        signal,
      }),
    enabled: Boolean(info),
  });
  if (!info || purchase.isPending) return <Loading />;
  if (!purchase.data)
    return (
      <div className="grid w-full max-w-2xl gap-4">
        <PageHeader
          title={t('title')}
          back="/purchases"
          backLabel={t('backToList')}
        />
        <Alert variant="destructive">{t('notFound')}</Alert>
      </div>
    );
  const p = purchase.data;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const costs = p.total !== null;

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader
        title={t('number', { number: p.number })}
        back="/purchases"
        backLabel={t('backToList')}
      >
        {p.status === 'DRAFT' && can(info, 'purchases.create') && costs ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/purchases/${p.id}/edit`}>{t('edit')}</Link>
          </Button>
        ) : null}
      </PageHeader>
      {receiveError && p.status === 'DRAFT' ? (
        <Alert variant="destructive">
          {t('savedNotReceived')} {tErr(receiveError)}
        </Alert>
      ) : null}
      <Card>
        <CardContent className="grid gap-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            {can(info, 'suppliers.read') ? (
              <Link
                href={`/suppliers/${p.supplierId}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {p.supplierName}
              </Link>
            ) : (
              <span className="font-medium">{p.supplierName}</span>
            )}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {p.supplierReference ? (
              <>
                <dt className="text-muted-foreground">
                  {t('fieldNames.supplierReference')}
                </dt>
                <dd>{p.supplierReference}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('created')}</dt>
            <dd>
              {when(p.createdAt)} · {p.createdByName ?? '—'}
            </dd>
            {p.receivedAt ? (
              <>
                <dt className="text-muted-foreground">{t('received')}</dt>
                <dd>
                  {when(p.receivedAt)} · {p.receivedByName ?? '—'}
                </dd>
              </>
            ) : null}
            {p.cancelledAt ? (
              <>
                <dt className="text-muted-foreground">{t('cancelled')}</dt>
                <dd>
                  {when(p.cancelledAt)} · {p.cancelledByName ?? '—'} ·{' '}
                  {p.cancelReason}
                </dd>
              </>
            ) : null}
            {p.note ? (
              <>
                <dt className="text-muted-foreground">
                  {t('fieldNames.note')}
                </dt>
                <dd>{p.note}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('goodsTitle')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid divide-y" data-testid="purchase-detail-lines">
            {p.lines.map((l) => (
              <li key={l.id} className="grid gap-0.5 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <Link
                    href={`/products/${l.productId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {l.productName}
                  </Link>
                  {l.lineTotal !== null ? (
                    <span>{money(l.lineTotal)}</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground">
                  {formatQuantity(l.quantity)} {l.unitName}
                  {l.unitCost !== null ? ` × ${money(l.unitCost)}` : ''}
                  {l.landedCostPerBase !== null
                    ? ` · ${t('landedCost', { amount: money(trimZeros(l.landedCostPerBase)) })}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          {p.charges.length > 0 ? (
            <ul className="grid gap-1 border-t pt-3 text-sm">
              {p.charges.map((c) => (
                <li key={c.id} className="flex justify-between gap-2">
                  <span>{c.description}</span>
                  {c.amount !== null ? <span>{money(c.amount)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {costs ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 text-sm">
              <dt>{t('subtotal')}</dt>
              <dd className="text-right">{money(p.subtotal)}</dd>
              <dt>{t('extraCosts')}</dt>
              <dd className="text-right">{money(p.extraCosts)}</dd>
              <dt className="font-semibold">{t('total')}</dt>
              <dd
                className="text-right font-semibold"
                data-testid="purchase-total"
              >
                {money(p.total)}
              </dd>
            </dl>
          ) : null}
        </CardContent>
      </Card>

      {p.payments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg font-semibold">{t('paymentsTitle')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid divide-y text-sm">
              {p.payments.map((pay) => (
                <li key={pay.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {pay.reference ?? '—'} · {when(pay.createdAt)}
                    {pay.reversed ? ` · ${t('paymentReversed')}` : ''}
                  </span>
                  {pay.amount !== null ? (
                    <span>{money(pay.amount)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {p.status === 'DRAFT' && can(info, 'purchases.receive') ? (
        <ReceiveCard info={info} purchase={p} />
      ) : null}
      {p.status !== 'CANCELLED' && can(info, 'purchases.cancel') ? (
        <CancelCard purchase={p} />
      ) : null}
    </div>
  );
}

function useRefreshPurchase(purchase: PurchaseDetail) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchase', purchase.id] }),
      queryClient.invalidateQueries({ queryKey: ['purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
      queryClient.invalidateQueries({
        queryKey: ['supplier', purchase.supplierId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['supplier-entries', purchase.supplierId],
      }),
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['movements'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['product'] }),
    ]);
  };
}

/** The goods have arrived: add them to stock, optionally with a payment. */
function ReceiveCard({
  info,
  purchase,
}: {
  info: SessionInfo;
  purchase: PurchaseDetail;
}) {
  const t = useTranslations('Purchases');
  const tErr = useTranslations('Errors');
  const refresh = useRefreshPurchase(purchase);
  const canPay = can(info, 'supplier_payments.create');
  const [payment, setPayment] = useState<PaymentInputState>(emptyPayment);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pay = canPay ? paymentBody(payment) : null;
    if (pay && !/^[1-9]\d*$/.test(pay.amount)) {
      setError('amount_invalid');
      return;
    }
    setPending(true);
    try {
      // Receiving twice changes nothing, so a retry is always safe.
      await apiFetch(`/shops/current/purchases/${purchase.id}/receive`, {
        method: 'POST',
        body: pay ? { payment: pay } : {},
      });
      await refresh();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('receiveTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('receiveHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          {canPay ? (
            <PaymentFields
              id="receive-pay"
              value={payment}
              onChange={setPayment}
              amountLabel={t('paidNow')}
            />
          ) : null}
          {error ? (
            <Alert variant="destructive">
              {error === 'amount_invalid'
                ? t('fix', { field: t('fieldNames.payment') })
                : tErr(error)}
            </Alert>
          ) : null}
          <Button
            type="submit"
            className="justify-self-start"
            disabled={pending}
          >
            {t('receive')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Cancels a draft, or reverses a received purchase (A-027). */
function CancelCard({ purchase }: { purchase: PurchaseDetail }) {
  const t = useTranslations('Purchases');
  const tErr = useTranslations('Errors');
  const refresh = useRefreshPurchase(purchase);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const received = purchase.status === 'RECEIVED';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('reason_required');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiFetch(`/shops/current/purchases/${purchase.id}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      await refresh();
    } catch (err) {
      setError(errorKey(err));
      setPending(false);
    }
  };

  if (!open)
    return (
      <Button
        variant="outline"
        className="justify-self-start"
        onClick={() => setOpen(true)}
      >
        {received ? t('cancelReceived') : t('cancelDraft')}
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">
            {received ? t('cancelReceived') : t('cancelDraft')}
          </h2>
        </CardTitle>
        <CardDescription>
          {received ? t('cancelReceivedHelp') : t('cancelDraftHelp')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <Field
            id="cancel-reason"
            label={t('cancelReason')}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? (
            <Alert variant="destructive">
              {error === 'reason_required' ? t('reasonRequired') : tErr(error)}
            </Alert>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {t('confirmCancel')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t('keep')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
