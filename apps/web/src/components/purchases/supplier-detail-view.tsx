'use client';

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  SessionInfo,
  SupplierEntryView,
  SupplierPaymentView,
  SupplierView,
} from '@ksm/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Field } from '@/components/forms/field';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { newRequestKey } from '@/lib/quantity';
import { can, errorKey } from '@/lib/session';
import {
  emptyPayment,
  money,
  paymentBody,
  PaymentFields,
  type PaymentInputState,
} from './common';
import { BalanceText } from './suppliers-view';

/** The detail page reads the supplier id from the URL. */
export function SupplierDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <SupplierDetailView supplierId={id} />;
}

/** One supplier: contact details, balance, payments and account history. */
export function SupplierDetailView({ supplierId }: { supplierId: string }) {
  const t = useTranslations('Suppliers');
  const info = useShopSession(`/suppliers/${supplierId}`);
  const supplier = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: ({ signal }) =>
      apiFetch<SupplierView>(`/shops/current/suppliers/${supplierId}`, {
        signal,
      }),
    enabled: Boolean(info),
  });
  if (!info || supplier.isPending) return <Loading />;
  if (!supplier.data)
    return (
      <div className="grid w-full max-w-2xl gap-4">
        <PageHeader
          title={t('title')}
          back="/suppliers"
          backLabel={t('backToList')}
        />
        <Alert variant="destructive">{t('notFound')}</Alert>
      </div>
    );
  const s = supplier.data;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={s.name} back="/suppliers" backLabel={t('backToList')}>
        {can(info, 'purchases.create') && !s.archived ? (
          <Button asChild size="sm">
            <Link href={`/purchases/new?supplierId=${s.id}`}>
              {t('newPurchase')}
            </Link>
          </Button>
        ) : null}
      </PageHeader>
      <Summary info={info} supplier={s} />
      {can(info, 'supplier_payments.create') &&
      s.balance !== null &&
      !s.balance.startsWith('-') &&
      /[1-9]/.test(s.balance) ? (
        <PayForm supplier={s} />
      ) : null}
      <Ledger info={info} supplierId={s.id} />
    </div>
  );
}

function useRefreshSupplier(supplierId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] }),
      queryClient.invalidateQueries({
        queryKey: ['supplier-entries', supplierId],
      }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
    ]);
  };
}

function Summary({
  info,
  supplier: s,
}: {
  info: SessionInfo;
  supplier: SupplierView;
}) {
  const t = useTranslations('Suppliers');
  const tErr = useTranslations('Errors');
  const refresh = useRefreshSupplier(s.id);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const setArchived = async (archived: boolean) => {
    setError(null);
    setPending(true);
    try {
      await apiFetch(`/shops/current/suppliers/${s.id}`, {
        method: 'PATCH',
        body: { archived },
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
      <CardContent className="grid gap-3 py-4">
        {s.balance !== null ? (
          <p className="text-2xl font-semibold" data-testid="supplier-balance">
            <BalanceText balance={s.balance} />
          </p>
        ) : null}
        {s.archived ? <Badge variant="secondary">{t('archived')}</Badge> : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {s.phone ? (
            <>
              <dt className="text-muted-foreground">{t('fieldNames.phone')}</dt>
              <dd>{s.phone}</dd>
            </>
          ) : null}
          {s.address ? (
            <>
              <dt className="text-muted-foreground">
                {t('fieldNames.address')}
              </dt>
              <dd>{s.address}</dd>
            </>
          ) : null}
        </dl>
        {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
        {can(info, 'suppliers.manage') ? (
          <Button
            variant="outline"
            className="justify-self-start"
            disabled={pending}
            onClick={() => void setArchived(!s.archived)}
          >
            {s.archived ? t('restore') : t('archive')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PayForm({ supplier: s }: { supplier: SupplierView }) {
  const t = useTranslations('Suppliers');
  const tErr = useTranslations('Errors');
  const refresh = useRefreshSupplier(s.id);
  const [payment, setPayment] = useState<PaymentInputState>(emptyPayment);
  // One key per attempt, so a retry after a lost response is not applied twice.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const body = paymentBody(payment);
    if (!body || !/^\d+$/.test(body.amount) || !/[1-9]/.test(body.amount)) {
      setError('amount_invalid');
      return;
    }
    setPending(true);
    try {
      const paid = await apiFetch<SupplierPaymentView>(
        `/shops/current/suppliers/${s.id}/payments`,
        { method: 'POST', body: { ...body, idempotencyKey: requestKey } },
      );
      setDone(t('paid', { amount: money(paid.amount) }));
      setPayment(emptyPayment());
      setRequestKey(newRequestKey());
      await refresh();
    } catch (err) {
      const code = errorKey(err);
      setError(code);
      // The server answered, so nothing was saved: the next attempt is new.
      if (code !== 'network' && code !== 'generic')
        setRequestKey(newRequestKey());
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('payTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <PaymentFields
            id="pay"
            value={payment}
            onChange={setPayment}
            amountLabel={t('amount')}
          />
          {error ? (
            <Alert variant="destructive">
              {error === 'amount_invalid' ? t('amountInvalid') : tErr(error)}
            </Alert>
          ) : null}
          {done ? (
            <Alert role="status" data-testid="pay-done">
              {done}
            </Alert>
          ) : null}
          <Button
            type="submit"
            className="justify-self-start"
            disabled={pending}
          >
            {t('pay')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Ledger({
  info,
  supplierId,
}: {
  info: SessionInfo;
  supplierId: string;
}) {
  const t = useTranslations('Suppliers');
  const format = useFormatter();
  const [reversing, setReversing] = useState<string | null>(null);
  const entries = useInfiniteQuery({
    queryKey: ['supplier-entries', supplierId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ entries: SupplierEntryView[]; nextCursor: string | null }>(
        `/shops/current/suppliers/${supplierId}/entries?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = entries.data?.pages.flatMap((p) => p.entries) ?? [];
  const canReverse = can(info, 'purchases.cancel');

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('historyTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {entries.isPending ? (
          <Loading />
        ) : entries.isError ? (
          <Alert variant="destructive">{t('loadFailed')}</Alert>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noHistory')}</p>
        ) : (
          <ul className="grid divide-y" data-testid="supplier-history">
            {rows.map((e) => (
              <li key={e.id} className="grid gap-1 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {t(`entryTypes.${e.type}`)}
                    {e.purchaseId && e.purchaseNumber !== null ? (
                      <>
                        {' · '}
                        <Link
                          href={`/purchases/${e.purchaseId}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {t('purchaseNumber', { number: e.purchaseNumber })}
                        </Link>
                      </>
                    ) : null}
                    {e.paymentReversed ? (
                      <Badge variant="secondary" className="ml-2">
                        {t('reversed')}
                      </Badge>
                    ) : null}
                  </span>
                  {e.amount !== null ? <span>{money(e.amount)}</span> : null}
                </div>
                <span className="text-muted-foreground">
                  {e.balanceAfter !== null
                    ? `${t('balanceAfter', { amount: money(e.balanceAfter) })} · `
                    : ''}
                  {e.note ? `${e.note} · ` : ''}
                  {e.actorName ?? '—'} ·{' '}
                  {format.dateTime(new Date(e.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {canReverse &&
                e.type === 'PAYMENT' &&
                e.paymentId &&
                !e.paymentReversed ? (
                  reversing === e.paymentId ? (
                    <ReverseForm
                      supplierId={supplierId}
                      paymentId={e.paymentId}
                      onClose={() => setReversing(null)}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-self-start"
                      onClick={() => setReversing(e.paymentId)}
                    >
                      {t('reverse')}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {entries.hasNextPage ? (
          <Button
            variant="outline"
            disabled={entries.isFetchingNextPage}
            onClick={() => void entries.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Corrects a payment recorded by mistake; the reason is kept. */
function ReverseForm({
  supplierId,
  paymentId,
  onClose,
}: {
  supplierId: string;
  paymentId: string;
  onClose: () => void;
}) {
  const t = useTranslations('Suppliers');
  const tErr = useTranslations('Errors');
  const refresh = useRefreshSupplier(supplierId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError('reason_required');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiFetch(
        `/shops/current/suppliers/${supplierId}/payments/${paymentId}/reverse`,
        { method: 'POST', body: { reason: reason.trim() } },
      );
      await refresh();
      onClose();
    } catch (err) {
      setError(errorKey(err));
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-2 rounded-md border p-3"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <Field
        id={`reverse-${paymentId}`}
        label={t('reverseReason')}
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
          {t('confirmReverse')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
