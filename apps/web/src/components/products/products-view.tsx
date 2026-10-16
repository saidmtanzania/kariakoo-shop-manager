'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  CategoryView,
  InventorySummary,
  ProductListItem,
  SessionInfo,
} from '@ksm/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { formatQuantity } from '@/lib/quantity';
import { can } from '@/lib/session';

type Filter = 'all' | 'low' | 'out' | 'archived';

export const selectClass =
  'border-input h-12 w-full rounded-md border bg-transparent px-3 text-base md:h-10 md:text-sm';

/** Product list with search by name, SKU or barcode (WF-05, NFR-1). */
export function ProductsView() {
  const t = useTranslations('Products');
  const info = useShopSession('/products');
  if (!info) return <Loading />;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={t('title')} back="/" backLabel={t('back')}>
        {can(info, 'products.create') ? (
          <Button asChild size="sm">
            <Link href="/products/new">{t('add')}</Link>
          </Button>
        ) : null}
      </PageHeader>
      {can(info, 'products.read') ? (
        <ProductList info={info} />
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function ProductList({ info }: { info: SessionInfo }) {
  const t = useTranslations('Products');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryId, setCategoryId] = useState('');
  const q = useDebounced(search.trim(), 250);
  const canSeeStock = can(info, 'inventory.read');

  const categories = useQuery({
    queryKey: ['product-categories'],
    queryFn: ({ signal }) =>
      apiFetch<{ categories: CategoryView[] }>(
        '/shops/current/product-categories',
        { signal },
      ),
  });
  const summary = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: ({ signal }) =>
      apiFetch<InventorySummary>('/shops/current/inventory/summary', {
        signal,
      }),
    enabled: canSeeStock,
  });

  const products = useInfiniteQuery({
    queryKey: ['products', q, filter, categoryId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (q) params.set('q', q);
      if (categoryId) params.set('categoryId', categoryId);
      if (filter === 'archived') params.set('archived', 'true');
      else if (filter !== 'all') params.set('stock', filter);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<{
        products: ProductListItem[];
        nextCursor: string | null;
      }>(`/shops/current/products?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = products.data?.pages.flatMap((p) => p.products) ?? [];
  const low = summary.data?.lowStockCount ?? 0;

  return (
    <>
      {low > 0 && filter !== 'low' ? (
        <Alert data-testid="low-stock-alert">
          {t('lowStockAlert', { count: low })}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setFilter('low')}
          >
            {t('showLowStock')}
          </button>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="grid gap-2">
          <Label htmlFor="product-search">{t('search')}</Label>
          <Input
            id="product-search"
            type="search"
            className="h-12 md:h-10"
            placeholder={t('searchPlaceholder')}
            value={search}
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-filter">{t('show')}</Label>
          <select
            id="product-filter"
            className={selectClass}
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">{t('filters.all')}</option>
            {canSeeStock ? (
              <>
                <option value="low">{t('filters.low')}</option>
                <option value="out">{t('filters.out')}</option>
              </>
            ) : null}
            <option value="archived">{t('filters.archived')}</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-category">{t('category')}</Label>
          <select
            id="product-category"
            className={selectClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t('allCategories')}</option>
            {(categories.data?.categories ?? [])
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {products.isError ? (
        <Alert variant="destructive">{t('loadFailed')}</Alert>
      ) : products.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 py-6 text-center">
            <p
              className="text-muted-foreground text-sm"
              data-testid="products-empty"
            >
              {q || filter !== 'all' || categoryId
                ? t('noMatches')
                : t('empty')}
            </p>
            {!q && filter === 'all' && can(info, 'products.create') ? (
              <Button asChild className="justify-self-center">
                <Link href="/products/new">{t('addFirst')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul
          className="bg-card grid divide-y rounded-xl border"
          data-testid="product-list"
        >
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/products/${p.id}`}
                className="hover:bg-muted/50 flex min-h-14 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {[p.sku, p.categoryName].filter(Boolean).join(' · ') ||
                      t('perUnit', { unit: p.baseUnit.name })}
                  </span>
                </span>
                <span className="grid justify-items-end gap-0.5 text-sm">
                  {p.retailPrice ? (
                    <span>
                      {formatMoney(p.retailPrice, 'TZS')}
                      <span className="text-muted-foreground">
                        {' '}
                        / {p.baseUnit.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('noPrice')}
                    </span>
                  )}
                  {p.quantity !== null ? (
                    <span className="flex items-center gap-1">
                      <span data-testid={`stock-${p.id}`}>
                        {t('inStock', {
                          quantity: formatQuantity(p.quantity),
                          unit: p.baseUnit.name,
                        })}
                      </span>
                      {p.lowStock ? (
                        <Badge variant="destructive">{t('low')}</Badge>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {products.hasNextPage ? (
        <Button
          variant="outline"
          disabled={products.isFetchingNextPage}
          onClick={() => void products.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </>
  );
}
