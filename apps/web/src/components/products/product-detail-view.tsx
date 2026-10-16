'use client';

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adjustmentReasons,
  type AdjustmentKind,
  type AdjustmentReason,
  type CategoryView,
  type ProductDetail,
  type SessionInfo,
  type StockMovementView,
  type UnitView,
} from '@ksm/shared';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { formatQuantity, newRequestKey } from '@/lib/quantity';
import { can, errorKey } from '@/lib/session';
import { canSeeCosts } from './new-product-view';
import { selectClass } from './products-view';

const opt = (v: string) => (v.trim() === '' ? null : v.trim());
const money = (v: string | null) => (v === null ? '—' : formatMoney(v, 'TZS'));

/** One product: stock, adjustments, units and prices, history. */
/** The detail page reads the product id from the URL. */
export function ProductDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProductDetailView productId={id} />;
}

export function ProductDetailView({ productId }: { productId: string }) {
  const t = useTranslations('Products');
  const info = useShopSession(`/products/${productId}`);
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: ({ signal }) =>
      apiFetch<ProductDetail>(`/shops/current/products/${productId}`, {
        signal,
      }),
    enabled: !!info && can(info, 'products.read'),
    retry: false,
  });

  if (!info) return <Loading />;
  if (!can(info, 'products.read')) return <Alert>{t('noAccess')}</Alert>;
  if (product.isError) {
    return (
      <div className="grid w-full max-w-2xl gap-4">
        <PageHeader
          title={t('title')}
          back="/products"
          backLabel={t('backToList')}
        />
        <Alert variant="destructive">{t('notFound')}</Alert>
      </div>
    );
  }
  if (!product.data) return <Loading />;
  const p = product.data;

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader title={p.name} back="/products" backLabel={t('backToList')} />
      <div className="flex flex-wrap gap-2">
        {p.archived ? <Badge variant="secondary">{t('archived')}</Badge> : null}
        {p.stock.lowStock ? (
          <Badge variant="destructive">{t('lowStock')}</Badge>
        ) : null}
        {p.sku ? (
          <Badge variant="outline">{t('skuBadge', { sku: p.sku })}</Badge>
        ) : null}
        {p.categoryName ? (
          <Badge variant="outline">{p.categoryName}</Badge>
        ) : null}
      </div>
      {can(info, 'inventory.read') ? (
        <StockCard info={info} product={p} />
      ) : null}
      <UnitsCard info={info} product={p} />
      {can(info, 'products.update') && !p.archived ? (
        <DetailsCard product={p} />
      ) : null}
      {can(info, 'inventory.read') ? <HistoryCard product={p} /> : null}
      {can(info, 'products.archive') ? <ArchiveCard product={p} /> : null}
    </div>
  );
}

function useRefresh(productId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['movements', productId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] }),
    ]);
}

/** "24 piece" plus the same stock in larger units ("= 2 carton"). */
function StockCard({
  info,
  product,
}: {
  info: SessionInfo;
  product: ProductDetail;
}) {
  const t = useTranslations('Products');
  const base = product.units.find((u) => u.isBase)!;
  const quantity = product.stock.quantity ?? '0';
  const active = product.units.filter((u) => !u.archived);
  const showOpening =
    !product.stock.hasMovements &&
    !product.archived &&
    can(info, 'inventory.opening');
  const showAdjust =
    product.stock.hasMovements &&
    !product.archived &&
    can(info, 'inventory.adjust');

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('inStockLabel')}</CardDescription>
        <CardTitle>
          <p className="text-3xl font-semibold" data-testid="stock-quantity">
            {formatQuantity(quantity)} {base.name}
          </p>
        </CardTitle>
        {product.stock.averageCost !== null ? (
          <CardDescription>
            {t('averageCost', {
              cost: formatMoney(
                product.stock.averageCost.replace(/(\.\d{2})\d+$/, '$1'),
                'TZS',
              ),
              unit: base.name,
            })}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {active.length > 1 ? (
          <ul className="text-muted-foreground grid gap-1 text-sm">
            {active
              .filter((u) => !u.isBase)
              .map((u) => (
                <li key={u.id}>
                  {t('unitContains', {
                    unit: u.name,
                    count: formatQuantity(u.conversion),
                    base: base.name,
                  })}
                </li>
              ))}
          </ul>
        ) : null}
        {showOpening ? <OpeningForm info={info} product={product} /> : null}
        {showAdjust ? <AdjustForm info={info} product={product} /> : null}
        {!product.stock.hasMovements &&
        !showOpening &&
        can(info, 'inventory.adjust') &&
        !product.archived ? (
          <AdjustForm info={info} product={product} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function UnitSelect({
  id,
  units,
  value,
  onChange,
}: {
  id: string;
  units: UnitView[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('Products');
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t('fields.unit')}</Label>
      <select
        id={id}
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {units
          .filter((u) => !u.archived)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function OpeningForm({
  info,
  product,
}: {
  info: SessionInfo;
  product: ProductDetail;
}) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const [unitId, setUnitId] = useState(product.units[0]!.id);
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch(`/shops/current/products/${product.id}/opening-stock`, {
        method: 'POST',
        body: { unitId, quantity: quantity.trim(), unitCost: opt(cost) },
      });
      setQuantity('');
      await refresh();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-3 border-t pt-4"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <h2 className="font-medium">{t('openingTitle')}</h2>
      <p className="text-muted-foreground text-sm">{t('openingHelp')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id="opening-quantity"
          label={t('fields.quantity')}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <UnitSelect
          id="opening-unit"
          units={product.units}
          value={unitId}
          onChange={setUnitId}
        />
        {canSeeCosts(info) ? (
          <Field
            id="opening-cost"
            label={t('fields.unitCost')}
            inputMode="numeric"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        ) : null}
      </div>
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      <Button type="submit" disabled={pending || !quantity.trim()}>
        {t('saveOpening')}
      </Button>
    </form>
  );
}

function AdjustForm({
  info,
  product,
}: {
  info: SessionInfo;
  product: ProductDetail;
}) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const [kind, setKind] = useState<AdjustmentKind>('remove');
  const [unitId, setUnitId] = useState(product.units[0]!.id);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('DAMAGED');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  // One key per attempt, so a retry after a lost response is not applied twice.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const res = await apiFetch<{ movement: StockMovementView }>(
        '/shops/current/inventory/adjustments',
        {
          method: 'POST',
          body: {
            productId: product.id,
            unitId,
            kind,
            quantity: quantity.trim(),
            reason,
            note: opt(note),
            unitCost: kind === 'add' ? opt(cost) : null,
            idempotencyKey: requestKey,
          },
        },
      );
      setDone(
        t('adjusted', {
          quantity: formatQuantity(res.movement.balanceAfter),
          unit: product.units.find((u) => u.isBase)!.name,
        }),
      );
      setQuantity('');
      setNote('');
      setCost('');
      setRequestKey(newRequestKey());
      await refresh();
    } catch (err) {
      const code = errorKey(err);
      setError(code);
      // The server answered, so nothing was saved: the next attempt is new.
      // After a lost response, keep the key so a retry cannot apply twice.
      if (code !== 'network' && code !== 'generic')
        setRequestKey(newRequestKey());
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-3 border-t pt-4"
      onSubmit={(e) => void submit(e)}
      noValidate
      data-testid="adjust-form"
    >
      <h2 className="font-medium">{t('adjustTitle')}</h2>
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="sr-only">{t('adjustKind')}</legend>
        {(['add', 'remove', 'count'] as const).map((k) => (
          <label
            key={k}
            className="has-[:checked]:border-primary has-[:checked]:bg-muted flex min-h-12 items-center justify-center gap-2 rounded-md border px-2 text-sm"
          >
            <input
              type="radio"
              name="adjust-kind"
              className="size-4"
              checked={kind === k}
              onChange={() => {
                setKind(k);
                if (k === 'count') setReason('COUNT_CORRECTION');
                else if (k === 'add' && reason === 'DAMAGED')
                  setReason('FOUND');
              }}
            />
            {t(`kinds.${k}`)}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="adjust-quantity"
          label={kind === 'count' ? t('countedQuantity') : t('fields.quantity')}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <UnitSelect
          id="adjust-unit"
          units={product.units}
          value={unitId}
          onChange={setUnitId}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="adjust-reason">{t('reason')}</Label>
        <select
          id="adjust-reason"
          className={selectClass}
          value={reason}
          onChange={(e) => setReason(e.target.value as AdjustmentReason)}
        >
          {adjustmentReasons.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        id="adjust-note"
        label={reason === 'OTHER' ? t('noteRequired') : t('note')}
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
      />
      {kind === 'add' && canSeeCosts(info) ? (
        <Field
          id="adjust-cost"
          label={t('fields.unitCostOptional')}
          inputMode="numeric"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      ) : null}
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      {done ? (
        <Alert data-testid="adjust-done" role="status">
          {done}
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending || !quantity.trim()}>
        {pending ? t('saving') : t('saveAdjustment')}
      </Button>
    </form>
  );
}

function UnitsCard({
  info,
  product,
}: {
  info: SessionInfo;
  product: ProductDetail;
}) {
  const t = useTranslations('Products');
  const base = product.units.find((u) => u.isBase)!;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const editable = !product.archived;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('unitsTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid divide-y" data-testid="unit-list">
          {product.units.map((u) => (
            <li
              key={u.id}
              className="grid gap-2 py-3"
              data-testid={`unit-${u.name}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {u.name}{' '}
                  {u.isBase ? (
                    <Badge variant="secondary">{t('baseBadge')}</Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      {t('unitEquals', {
                        count: formatQuantity(u.conversion),
                        base: base.name,
                      })}
                    </span>
                  )}
                  {u.archived ? (
                    <Badge variant="outline">{t('archived')}</Badge>
                  ) : null}
                </span>
                {editable &&
                !u.archived &&
                can(info, 'products.prices.update') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(editing === u.id ? null : u.id)}
                  >
                    {t('editPrices')}
                  </Button>
                ) : null}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm">
                <dt className="text-muted-foreground">{t('retailPrice')}</dt>
                <dd>{money(u.retailPrice)}</dd>
                <dt className="text-muted-foreground">{t('wholesalePrice')}</dt>
                <dd>{money(u.wholesalePrice)}</dd>
                {product.canSeeCosts ? (
                  <>
                    <dt className="text-muted-foreground">
                      {t('buyingPrice')}
                    </dt>
                    <dd>{money(u.buyingPrice)}</dd>
                  </>
                ) : null}
                {u.barcode ? (
                  <>
                    <dt className="text-muted-foreground">
                      {t('fields.barcode')}
                    </dt>
                    <dd className="font-mono">{u.barcode}</dd>
                  </>
                ) : null}
              </dl>
              {editing === u.id ? (
                <PricesForm
                  product={product}
                  unit={u}
                  onDone={() => setEditing(null)}
                />
              ) : null}
              {editable && !u.isBase && can(info, 'products.update') ? (
                <UnitArchiveButton product={product} unit={u} />
              ) : null}
            </li>
          ))}
        </ul>
        {editable && can(info, 'products.update') ? (
          adding ? (
            <AddUnitForm product={product} onDone={() => setAdding(false)} />
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)}>
              {t('addUnit')}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function PricesForm({
  product,
  unit,
  onDone,
}: {
  product: ProductDetail;
  unit: UnitView;
  onDone: () => void;
}) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const whole = (v: string | null) => (v ? v.replace(/\.00$/, '') : '');
  const [retail, setRetail] = useState(whole(unit.retailPrice));
  const [wholesale, setWholesale] = useState(whole(unit.wholesalePrice));
  const [buying, setBuying] = useState(whole(unit.buyingPrice));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch(
        `/shops/current/products/${product.id}/units/${unit.id}/prices`,
        {
          method: 'PUT',
          body: {
            retailPrice: opt(retail),
            wholesalePrice: opt(wholesale),
            ...(product.canSeeCosts ? { buyingPrice: opt(buying) } : {}),
          },
        },
      );
      await refresh();
      onDone();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="bg-muted/40 grid gap-3 rounded-md p-3"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id={`price-retail-${unit.id}`}
          label={t('retailPrice')}
          inputMode="numeric"
          value={retail}
          onChange={(e) => setRetail(e.target.value)}
        />
        <Field
          id={`price-wholesale-${unit.id}`}
          label={t('wholesalePrice')}
          inputMode="numeric"
          value={wholesale}
          onChange={(e) => setWholesale(e.target.value)}
        />
        {product.canSeeCosts ? (
          <Field
            id={`price-buying-${unit.id}`}
            label={t('buyingPrice')}
            inputMode="numeric"
            value={buying}
            onChange={(e) => setBuying(e.target.value)}
          />
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{t('wholeShillings')}</p>
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('savePrices')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function UnitArchiveButton({
  product,
  unit,
}: {
  product: ProductDetail;
  unit: UnitView;
}) {
  const t = useTranslations('Products');
  const refresh = useRefresh(product.id);
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="justify-self-start"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await apiFetch(
            `/shops/current/products/${product.id}/units/${unit.id}`,
            {
              method: 'PATCH',
              body: { archived: !unit.archived },
            },
          );
          await refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {unit.archived ? t('restoreUnit') : t('archiveUnit')}
    </Button>
  );
}

function AddUnitForm({
  product,
  onDone,
}: {
  product: ProductDetail;
  onDone: () => void;
}) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const base = product.units.find((u) => u.isBase)!;
  const [name, setName] = useState('');
  const [conversion, setConversion] = useState('');
  const [barcode, setBarcode] = useState('');
  const [retail, setRetail] = useState('');
  const [wholesale, setWholesale] = useState('');
  const [allowFraction, setAllowFraction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch(`/shops/current/products/${product.id}/units`, {
        method: 'POST',
        body: {
          name,
          conversion: conversion.trim(),
          barcode: opt(barcode),
          allowFraction,
          retailPrice: opt(retail),
          wholesalePrice: opt(wholesale),
        },
      });
      await refresh();
      onDone();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="grid gap-3 border-t pt-4"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id="new-unit-name"
          label={t('fields.unitName')}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          id="new-unit-conversion"
          label={t('fields.conversion', { unit: base.name })}
          inputMode="decimal"
          value={conversion}
          onChange={(e) => setConversion(e.target.value)}
        />
        <Field
          id="new-unit-barcode"
          label={t('fields.barcode')}
          value={barcode}
          maxLength={64}
          onChange={(e) => setBarcode(e.target.value)}
        />
        <Field
          id="new-unit-retail"
          label={t('retailPrice')}
          inputMode="numeric"
          value={retail}
          onChange={(e) => setRetail(e.target.value)}
        />
        <Field
          id="new-unit-wholesale"
          label={t('wholesalePrice')}
          inputMode="numeric"
          value={wholesale}
          onChange={(e) => setWholesale(e.target.value)}
        />
      </div>
      <label className="flex min-h-12 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5"
          checked={allowFraction}
          onChange={(e) => setAllowFraction(e.target.checked)}
        />
        {t('allowFraction')}
      </label>
      <p className="text-muted-foreground text-xs">{t('conversionFixed')}</p>
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('saveUnit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function DetailsCard({ product }: { product: ProductDetail }) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const categories = useQuery({
    queryKey: ['product-categories'],
    queryFn: ({ signal }) =>
      apiFetch<{ categories: CategoryView[] }>(
        '/shops/current/product-categories',
        { signal },
      ),
  });
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId ?? '');
  const [reorder, setReorder] = useState(
    product.reorderLevel
      ? formatQuantity(product.reorderLevel).replace(/,/g, '')
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const base = product.units.find((u) => u.isBase)!;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      await apiFetch(`/shops/current/products/${product.id}`, {
        method: 'PATCH',
        body: {
          name,
          sku: opt(sku),
          categoryId: categoryId || null,
          reorderLevel: opt(reorder),
        },
      });
      setSaved(true);
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
          <h2 className="text-lg font-semibold">{t('details')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => void submit(e)}
          noValidate
        >
          <Field
            id="edit-name"
            label={t('fields.name')}
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="edit-sku"
              label={t('fields.sku')}
              value={sku}
              maxLength={40}
              onChange={(e) => setSku(e.target.value)}
            />
            <div className="grid gap-2">
              <Label htmlFor="edit-category">{t('category')}</Label>
              <select
                id="edit-category"
                className={selectClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t('noCategory')}</option>
                {(categories.data?.categories ?? [])
                  .filter((c) => !c.archived || c.id === product.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <Field
              id="edit-reorder"
              label={t('fields.reorderLevel', { unit: base.name })}
              inputMode="decimal"
              value={reorder}
              onChange={(e) => setReorder(e.target.value)}
            />
          </div>
          {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
          {saved ? <Alert role="status">{t('saved')}</Alert> : null}
          <Button type="submit" variant="outline" disabled={pending}>
            {t('saveDetails')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ product }: { product: ProductDetail }) {
  const t = useTranslations('Products');
  const format = useFormatter();
  const movements = useInfiniteQuery({
    queryKey: ['movements', product.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ movements: StockMovementView[]; nextCursor: string | null }>(
        `/shops/current/inventory/movements?productId=${product.id}&limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = movements.data?.pages.flatMap((p) => p.movements) ?? [];
  const base = product.units.find((u) => u.isBase)!;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-lg font-semibold">{t('historyTitle')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {movements.isPending ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noHistory')}</p>
        ) : (
          <ul className="grid divide-y" data-testid="movement-history">
            {rows.map((m) => (
              <li key={m.id} className="grid gap-0.5 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {t(`movementTypes.${m.type}`)}
                    {m.reason ? ` · ${t(`reasons.${m.reason}`)}` : ''}
                  </span>
                  <span
                    className={
                      m.quantity.startsWith('-') ? 'text-destructive' : ''
                    }
                  >
                    {m.quantity.startsWith('-') ? '' : '+'}
                    {formatQuantity(m.quantity)} {base.name}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {t('movementLine', {
                    entered: `${formatQuantity(m.unitQuantity)} ${m.unitName}`,
                    balance: formatQuantity(m.balanceAfter),
                    actor: m.actorName ?? '—',
                    date: format.dateTime(new Date(m.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
                {m.note ? (
                  <span className="text-muted-foreground">{m.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {movements.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => void movements.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ArchiveCard({ product }: { product: ProductDetail }) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const refresh = useRefresh(product.id);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Card>
      <CardContent className="grid gap-2 py-4">
        <p className="text-muted-foreground text-sm">
          {product.archived ? t('restoreHelp') : t('archiveHelp')}
        </p>
        {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            try {
              await apiFetch(
                `/shops/current/products/${product.id}/${product.archived ? 'restore' : 'archive'}`,
                { method: 'POST' },
              );
              await refresh();
            } catch (err) {
              setError(errorKey(err));
            } finally {
              setPending(false);
            }
          }}
        >
          {product.archived ? t('restore') : t('archive')}
        </Button>
      </CardContent>
    </Card>
  );
}
