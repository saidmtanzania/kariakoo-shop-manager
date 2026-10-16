'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import {
  purchaseStatuses,
  type PurchaseListItem,
  type PurchaseStatus,
  type SessionInfo,
} from '@ksm/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { canSeeCosts } from '@/components/products/new-product-view';
import { selectClass } from '@/components/products/products-view';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { can } from '@/lib/session';
import { money, StatusBadge } from './common';

/** Purchases, newest first: drafts waiting for goods and received ones. */
export function PurchasesView() {
  const t = useTranslations('Purchases');
  const info = useShopSession('/purchases');
  if (!info) return <Loading />;
  const canCreate = can(info, 'purchases.create') && canSeeCosts(info);
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={t('title')} back="/" backLabel={t('back')}>
        {can(info, 'suppliers.read') ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/suppliers">{t('suppliers')}</Link>
          </Button>
        ) : null}
        {canCreate ? (
          <Button asChild size="sm">
            <Link href="/purchases/new">{t('new')}</Link>
          </Button>
        ) : null}
      </PageHeader>
      {can(info, 'purchases.read') ? (
        <PurchaseList info={info} canCreate={canCreate} />
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function PurchaseList({
  canCreate,
}: {
  info: SessionInfo;
  canCreate: boolean;
}) {
  const t = useTranslations('Purchases');
  const format = useFormatter();
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const purchases = useInfiniteQuery({
    queryKey: ['purchases', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (status) params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<{
        purchases: PurchaseListItem[];
        nextCursor: string | null;
      }>(`/shops/current/purchases?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = purchases.data?.pages.flatMap((p) => p.purchases) ?? [];

  return (
    <>
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="purchase-status">{t('show')}</Label>
        <select
          id="purchase-status"
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')}
        >
          <option value="">{t('allStatuses')}</option>
          {purchaseStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {purchases.isError ? (
        <Alert variant="destructive">{t('loadFailed')}</Alert>
      ) : purchases.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 py-6 text-center">
            <p
              className="text-muted-foreground text-sm"
              data-testid="purchases-empty"
            >
              {status ? t('noMatches') : t('empty')}
            </p>
            {!status && canCreate ? (
              <Button asChild className="justify-self-center">
                <Link href="/purchases/new">{t('addFirst')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul
          className="bg-card grid divide-y rounded-xl border"
          data-testid="purchase-list"
        >
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/purchases/${p.id}`}
                className="hover:bg-muted/50 flex min-h-14 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">
                    {t('number', { number: p.number })} · {p.supplierName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('lineCount', { count: p.lineCount })} ·{' '}
                    {format.dateTime(new Date(p.receivedAt ?? p.createdAt), {
                      dateStyle: 'medium',
                    })}
                  </span>
                </span>
                <span className="grid justify-items-end gap-1 text-sm">
                  {p.total !== null ? <span>{money(p.total)}</span> : null}
                  <StatusBadge status={p.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {purchases.hasNextPage ? (
        <Button
          variant="outline"
          disabled={purchases.isFetchingNextPage}
          onClick={() => void purchases.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </>
  );
}
