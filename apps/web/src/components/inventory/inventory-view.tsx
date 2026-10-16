'use client';

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  InventorySummary,
  ReconciliationResult,
  SessionInfo,
  StockMovementView,
} from '@ksm/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { formatQuantity } from '@/lib/quantity';
import { can, errorKey } from '@/lib/session';

/** Stock overview: counts, the negative-stock setting, recent movements. */
export function InventoryView() {
  const t = useTranslations('Inventory');
  const info = useShopSession('/inventory');
  if (!info) return <Loading />;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={t('title')} back="/" backLabel={t('back')} />
      {can(info, 'inventory.read') ? (
        <>
          <Summary info={info} />
          <Reconciliation />
          <RecentMovements />
        </>
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function Summary({ info }: { info: SessionInfo }) {
  const t = useTranslations('Inventory');
  const summary = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: ({ signal }) =>
      apiFetch<InventorySummary>('/shops/current/inventory/summary', {
        signal,
      }),
  });
  const isOwner = Boolean(
    info.memberships.find((m) => m.shopId === info.activeShopId)?.isOwner,
  );
  if (summary.isPending) return <Loading />;
  if (!summary.data)
    return <Alert variant="destructive">{t('loadFailed')}</Alert>;
  const s = summary.data;
  const stats = [
    { key: 'products', value: s.productCount, href: '/products' },
    { key: 'low', value: s.lowStockCount, href: '/products' },
    { key: 'out', value: s.outOfStockCount, href: '/products' },
    { key: 'negative', value: s.negativeCount, href: '/products' },
  ] as const;
  return (
    <>
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <Link
              key={stat.key}
              href={stat.href}
              className="hover:bg-muted grid min-h-16 content-center rounded-md border p-3"
              data-testid={`summary-${stat.key}`}
            >
              <span className="text-2xl font-semibold">{stat.value}</span>
              <span className="text-muted-foreground text-sm">
                {t(`stats.${stat.key}`)}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
      <NegativeStockSetting allowed={s.allowNegativeStock} editable={isOwner} />
    </>
  );
}

/** D-007: blocked by default; only an owner can allow sales below zero. */
function NegativeStockSetting({
  allowed,
  editable,
}: {
  allowed: boolean;
  editable: boolean;
}) {
  const t = useTranslations('Inventory');
  const tErr = useTranslations('Errors');
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch('/shops/current/inventory/settings', {
        method: 'PUT',
        body: { allowNegativeStock: !allowed },
      });
      await queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
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
          <h2 className="text-lg font-semibold">{t('negativeTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm" data-testid="negative-setting">
          {allowed ? t('negativeAllowed') : t('negativeBlocked')}
        </p>
        <p className="text-muted-foreground text-xs">{t('negativeHelp')}</p>
        {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
        {editable ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void toggle()}
          >
            {allowed ? t('blockNegative') : t('allowNegative')}
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">{t('ownerOnly')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Reconciliation() {
  const t = useTranslations('Inventory');
  const check = useQuery({
    queryKey: ['inventory-reconciliation'],
    queryFn: ({ signal }) =>
      apiFetch<ReconciliationResult>(
        '/shops/current/inventory/reconciliation',
        {
          signal,
        },
      ),
    enabled: false,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('reconcileTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-muted-foreground text-sm">{t('reconcileHelp')}</p>
        {check.isError ? (
          <Alert variant="destructive">{t('loadFailed')}</Alert>
        ) : check.data ? (
          check.data.mismatches.length === 0 ? (
            <Alert role="status" data-testid="reconcile-result">
              {t('reconcileOk', { count: check.data.checkedProducts })}
            </Alert>
          ) : (
            <Alert variant="destructive" data-testid="reconcile-result">
              {t('reconcileMismatch', {
                count: check.data.mismatches.length,
              })}
              <ul className="mt-2 list-disc pl-5">
                {check.data.mismatches.map((m) => (
                  <li key={m.productId}>
                    {t('mismatchLine', {
                      name: m.productName,
                      balance: formatQuantity(m.balance),
                      ledger: formatQuantity(m.ledgerTotal),
                    })}
                  </li>
                ))}
              </ul>
            </Alert>
          )
        ) : null}
        <Button
          variant="outline"
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
        >
          {t('reconcileRun')}
        </Button>
      </CardContent>
    </Card>
  );
}

function RecentMovements() {
  const t = useTranslations('Inventory');
  const tp = useTranslations('Products');
  const format = useFormatter();
  const movements = useInfiniteQuery({
    queryKey: ['movements', 'all'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ movements: StockMovementView[]; nextCursor: string | null }>(
        `/shops/current/inventory/movements?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = movements.data?.pages.flatMap((p) => p.movements) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('recentTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {movements.isPending ? (
          <Loading />
        ) : movements.isError ? (
          <Alert variant="destructive">{t('loadFailed')}</Alert>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noMovements')}</p>
        ) : (
          <ul className="grid divide-y" data-testid="recent-movements">
            {rows.map((m) => {
              const out = m.quantity.startsWith('-');
              return (
                <li key={m.id} className="grid gap-0.5 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <Link
                      href={`/products/${m.productId}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {m.productName}
                    </Link>
                    <span className={out ? 'text-destructive' : ''}>
                      {out ? '' : '+'}
                      {formatQuantity(m.quantity)}
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {tp(`movementTypes.${m.type}`)}
                    {m.reason ? ` · ${tp(`reasons.${m.reason}`)}` : ''} ·{' '}
                    {m.actorName ?? '—'} ·{' '}
                    {format.dateTime(new Date(m.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {movements.hasNextPage ? (
          <Button
            variant="outline"
            disabled={movements.isFetchingNextPage}
            onClick={() => void movements.fetchNextPage()}
          >
            {tp('loadMore')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
