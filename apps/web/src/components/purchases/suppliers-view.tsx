'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  supplierSchema,
  type SessionInfo,
  type SupplierInput,
  type SupplierView,
} from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/forms/field';
import { canSeeCosts } from '@/components/products/new-product-view';
import {
  Loading,
  PageHeader,
  useShopSession,
} from '@/components/shell/shop-page';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { can, errorKey } from '@/lib/session';
import { cleanAmount, money, optText } from './common';

/** Suppliers of the shop, what is owed to each, and adding one. */
export function SuppliersView() {
  const t = useTranslations('Suppliers');
  const info = useShopSession('/suppliers');
  const [adding, setAdding] = useState(false);
  if (!info) return <Loading />;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={t('title')} back="/" backLabel={t('back')}>
        {can(info, 'suppliers.manage') && !adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        ) : null}
      </PageHeader>
      {adding ? (
        <AddSupplier info={info} onClose={() => setAdding(false)} />
      ) : null}
      {can(info, 'suppliers.read') ? (
        <SupplierList info={info} onAdd={() => setAdding(true)} />
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

/** "Owed TZS 5,000", or "Owes you" when the supplier owes the shop. */
export function BalanceText({ balance }: { balance: string | null }) {
  const t = useTranslations('Suppliers');
  if (balance === null) return null;
  if (balance.startsWith('-'))
    return (
      <span className="text-success">
        {t('owesYou', { amount: money(balance.slice(1)) })}
      </span>
    );
  if (!/[1-9]/.test(balance))
    return <span className="text-muted-foreground">{t('settled')}</span>;
  return <span>{t('owed', { amount: money(balance) })}</span>;
}

function SupplierList({
  info,
  onAdd,
}: {
  info: SessionInfo;
  onAdd: () => void;
}) {
  const t = useTranslations('Suppliers');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const suppliers = useInfiniteQuery({
    queryKey: ['suppliers', q, archived],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (q) params.set('q', q);
      if (archived) params.set('archived', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<{ suppliers: SupplierView[]; nextCursor: string | null }>(
        `/shops/current/suppliers?${params.toString()}`,
        { signal },
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = suppliers.data?.pages.flatMap((p) => p.suppliers) ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="supplier-search">{t('search')}</Label>
          <Input
            id="supplier-search"
            type="search"
            className="h-12 md:h-10"
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex min-h-12 items-center gap-2 text-sm md:min-h-10">
          <input
            type="checkbox"
            className="size-5"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t('showArchived')}
        </label>
      </div>
      {suppliers.isError ? (
        <Alert variant="destructive">{t('loadFailed')}</Alert>
      ) : suppliers.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 py-6 text-center">
            <p
              className="text-muted-foreground text-sm"
              data-testid="suppliers-empty"
            >
              {q || archived ? t('noMatches') : t('empty')}
            </p>
            {!q && !archived && can(info, 'suppliers.manage') ? (
              <Button className="justify-self-center" onClick={onAdd}>
                {t('addFirst')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <ul
          className="bg-card grid divide-y rounded-xl border"
          data-testid="supplier-list"
        >
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`/suppliers/${s.id}`}
                className="hover:bg-muted/50 flex min-h-14 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">{s.name}</span>
                  {s.phone ? (
                    <span className="text-muted-foreground text-xs">
                      {s.phone}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm" data-testid={`balance-${s.id}`}>
                  <BalanceText balance={s.balance} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suppliers.hasNextPage ? (
        <Button
          variant="outline"
          disabled={suppliers.isFetchingNextPage}
          onClick={() => void suppliers.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </>
  );
}

function AddSupplier({
  info,
  onClose,
}: {
  info: SessionInfo;
  onClose: () => void;
}) {
  const t = useTranslations('Suppliers');
  const tErr = useTranslations('Errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const costs = canSeeCosts(info);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [opening, setOpening] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setError(null);
    const body: SupplierInput = {
      name,
      phone: optText(phone),
      address: optText(address),
      openingBalance: costs ? optText(cleanAmount(opening)) : null,
    };
    const parsed = supplierSchema.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'name');
      setProblem(t('fix', { field: t(`fieldNames.${field}`) }));
      return;
    }
    setPending(true);
    try {
      const created = await apiFetch<SupplierView>('/shops/current/suppliers', {
        method: 'POST',
        body,
      });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      router.push(`/suppliers/${created.id}`);
    } catch (err) {
      setError(errorKey(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('addTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <Field
            id="supplier-name"
            label={t('fieldNames.name')}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="supplier-phone"
              label={t('fieldNames.phone')}
              type="tel"
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Field
              id="supplier-address"
              label={t('fieldNames.address')}
              maxLength={200}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          {costs ? (
            <div className="grid gap-1">
              <Field
                id="supplier-opening"
                label={t('fieldNames.openingBalance')}
                inputMode="numeric"
                autoComplete="off"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t('openingHelp')}
              </p>
            </div>
          ) : null}
          {problem ? <Alert variant="destructive">{problem}</Alert> : null}
          {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
