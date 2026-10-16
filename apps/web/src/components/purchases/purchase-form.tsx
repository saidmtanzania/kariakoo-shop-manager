'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  lineTotal,
  purchaseSchema,
  sumAmounts,
  type PurchaseDetail,
  type PurchaseInput,
  type ProductDetail,
  type ProductListItem,
  type SessionInfo,
  type SupplierView,
  type UnitView,
} from '@ksm/shared';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/forms/field';
import { canSeeCosts } from '@/components/products/new-product-view';
import { selectClass } from '@/components/products/products-view';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatQuantity, newRequestKey } from '@/lib/quantity';
import { can, errorKey } from '@/lib/session';
import {
  cleanAmount,
  emptyPayment,
  money,
  optText,
  paymentBody,
  PaymentFields,
  type PaymentInputState,
} from './common';

interface LineRow {
  key: number;
  productId: string;
  productName: string;
  units: UnitView[];
  unitId: string;
  quantity: string;
  unitCost: string;
}

interface ChargeRow {
  key: number;
  description: string;
  amount: string;
}

interface Initial {
  supplierId: string;
  supplierReference: string;
  note: string;
  lines: LineRow[];
  charges: ChargeRow[];
}

let rowKey = 0;
const nextKey = () => ++rowKey;

const activeUnits = (p: ProductDetail) => p.units.filter((u) => !u.archived);

/** The amount of a line, or null while its quantity or cost is incomplete. */
function safeLineTotal(quantity: string, cost: string): string | null {
  try {
    return lineTotal(quantity.trim(), cleanAmount(cost));
  } catch {
    return null;
  }
}

/** A new purchase (D-014): saved as a draft, or received straight away. */
export function NewPurchaseView() {
  const t = useTranslations('Purchases');
  const info = useShopSession('/purchases/new');
  const supplierId = useSearchParams().get('supplierId') ?? '';
  if (!info) return <Loading />;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader
        title={t('newTitle')}
        back="/purchases"
        backLabel={t('cancel')}
      />
      {can(info, 'purchases.create') && canSeeCosts(info) ? (
        <PurchaseForm
          info={info}
          initial={{
            supplierId,
            supplierReference: '',
            note: '',
            lines: [],
            charges: [],
          }}
        />
      ) : (
        <Alert>{t('noCreate')}</Alert>
      )}
    </div>
  );
}

/** Changing a draft before the goods arrive. */
export function EditPurchaseRoute() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('Purchases');
  const info = useShopSession(`/purchases/${id}/edit`);
  const loaded = useQuery({
    queryKey: ['purchase-edit', id],
    queryFn: async ({ signal }) => {
      const purchase = await apiFetch<PurchaseDetail>(
        `/shops/current/purchases/${id}`,
        { signal },
      );
      const ids = [...new Set(purchase.lines.map((l) => l.productId))];
      const products = await Promise.all(
        ids.map((pid) =>
          apiFetch<ProductDetail>(`/shops/current/products/${pid}`, {
            signal,
          }),
        ),
      );
      return { purchase, products };
    },
    enabled: Boolean(info),
    gcTime: 0,
  });
  if (!info || loaded.isPending) return <Loading />;
  const header = (
    <PageHeader
      title={
        loaded.data
          ? t('editTitle', { number: loaded.data.purchase.number })
          : t('title')
      }
      back={`/purchases/${id}`}
      backLabel={t('cancel')}
    />
  );
  if (!loaded.data)
    return (
      <div className="grid w-full max-w-2xl gap-4">
        {header}
        <Alert variant="destructive">{t('notFound')}</Alert>
      </div>
    );
  const { purchase, products } = loaded.data;
  if (purchase.status !== 'DRAFT' || !can(info, 'purchases.create'))
    return (
      <div className="grid w-full max-w-2xl gap-4">
        {header}
        <Alert>{t('notEditable')}</Alert>
      </div>
    );
  const byId = new Map(products.map((p) => [p.id, p]));
  return (
    <div className="grid w-full max-w-2xl gap-4">
      {header}
      <PurchaseForm
        info={info}
        purchaseId={purchase.id}
        initial={{
          supplierId: purchase.supplierId,
          supplierReference: purchase.supplierReference ?? '',
          note: purchase.note ?? '',
          lines: purchase.lines.map((l) => ({
            key: nextKey(),
            productId: l.productId,
            productName: l.productName,
            units: byId.get(l.productId)
              ? activeUnits(byId.get(l.productId)!)
              : [],
            unitId: l.unitId,
            quantity: formatQuantity(l.quantity).replace(/,/g, ''),
            unitCost: l.unitCost ?? '',
          })),
          charges: purchase.charges.map((c) => ({
            key: nextKey(),
            description: c.description,
            amount: c.amount ?? '',
          })),
        }}
      />
    </div>
  );
}

function PurchaseForm({
  info,
  purchaseId,
  initial,
}: {
  info: SessionInfo;
  purchaseId?: string;
  initial: Initial;
}) {
  const t = useTranslations('Purchases');
  const tErr = useTranslations('Errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const canReceive = can(info, 'purchases.receive');
  const canPay = can(info, 'supplier_payments.create');

  const suppliers = useQuery({
    queryKey: ['suppliers', 'active-all'],
    queryFn: ({ signal }) =>
      apiFetch<{ suppliers: SupplierView[] }>(
        '/shops/current/suppliers?limit=100',
        { signal },
      ),
  });

  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [reference, setReference] = useState(initial.supplierReference);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<LineRow[]>(initial.lines);
  const [charges, setCharges] = useState<ChargeRow[]>(initial.charges);
  const [payment, setPayment] = useState<PaymentInputState>(emptyPayment);
  // One key per attempt, so a retry after a lost response is not saved twice.
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const setLine = (key: number, patch: Partial<LineRow>) =>
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  const setCharge = (key: number, patch: Partial<ChargeRow>) =>
    setCharges((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const addProduct = (product: ProductDetail, matchedUnitId: string | null) => {
    const units = activeUnits(product);
    const unit =
      units.find((u) => u.id === matchedUnitId) ??
      units.find((u) => u.isBase) ??
      units[0];
    if (!unit) return;
    setLines((rows) => [
      ...rows,
      {
        key: nextKey(),
        productId: product.id,
        productName: product.name,
        units,
        unitId: unit.id,
        quantity: '',
        unitCost: unit.buyingPrice ?? '',
      },
    ]);
  };

  const lineTotals = lines.map((l) => safeLineTotal(l.quantity, l.unitCost));
  const chargeAmounts = charges.map((c) => cleanAmount(c.amount));
  const complete =
    lineTotals.every((v) => v !== null) &&
    chargeAmounts.every((a) => /^\d+$/.test(a));
  const subtotal = complete ? sumAmounts(lineTotals as string[]) : null;
  const extra = complete ? sumAmounts(chargeAmounts) : null;
  const total =
    subtotal !== null && extra !== null ? sumAmounts([subtotal, extra]) : null;

  const submit = async (e: FormEvent, receiveNow: boolean) => {
    e.preventDefault();
    setProblem(null);
    setError(null);
    const body: PurchaseInput = {
      supplierId,
      supplierReference: optText(reference),
      note: optText(note),
      lines: lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity.trim(),
        unitCost: cleanAmount(l.unitCost),
      })),
      charges: charges.map((c) => ({
        description: c.description,
        amount: cleanAmount(c.amount),
      })),
    };
    const parsed = purchaseSchema.safeParse(body);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      const field = String(
        [...path].reverse().find((p) => typeof p === 'string') ?? 'lines',
      );
      setProblem(
        t('fix', {
          field: t.has(`fieldNames.${field}`)
            ? t(`fieldNames.${field}`)
            : t('fieldNames.lines'),
        }),
      );
      return;
    }
    const pay = receiveNow && canPay ? paymentBody(payment) : null;
    if (pay && !/^[1-9]\d*$/.test(pay.amount)) {
      setProblem(t('fix', { field: t('fieldNames.payment') }));
      return;
    }
    setPending(true);
    let saved: PurchaseDetail;
    try {
      saved = purchaseId
        ? await apiFetch<PurchaseDetail>(
            `/shops/current/purchases/${purchaseId}`,
            { method: 'PUT', body },
          )
        : await apiFetch<PurchaseDetail>('/shops/current/purchases', {
            method: 'POST',
            body: { ...body, idempotencyKey: requestKey },
          });
    } catch (err) {
      const code = errorKey(err);
      setError(code);
      // The server answered, so nothing was saved: the next attempt is new.
      if (code !== 'network' && code !== 'generic')
        setRequestKey(newRequestKey());
      setPending(false);
      return;
    }
    // Next.js keeps this page's state when navigating away; start a fresh
    // form so coming back cannot replay or resubmit this purchase.
    if (!purchaseId) {
      setRequestKey(newRequestKey());
      setLines([]);
      setCharges([]);
      setReference('');
      setNote('');
      setPayment(emptyPayment());
    }
    let receiveError: string | null = null;
    if (receiveNow) {
      try {
        await apiFetch(`/shops/current/purchases/${saved.id}/receive`, {
          method: 'POST',
          body: pay ? { payment: pay } : {},
        });
      } catch (err) {
        receiveError = errorKey(err);
      }
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase', saved.id] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] }),
      ...(receiveNow
        ? [
            'supplier',
            'supplier-entries',
            'product',
            'products',
            'movements',
          ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
        : []),
    ]);
    router.push(
      `/purchases/${saved.id}${receiveError ? `?receiveError=${receiveError}` : ''}`,
    );
    setPending(false);
  };

  const activeSuppliers = (suppliers.data?.suppliers ?? []).filter(
    (s) => !s.archived,
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => void submit(e, false)}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('supplierTitle')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="purchase-supplier">
              {t('fieldNames.supplierId')}
            </Label>
            <select
              id="purchase-supplier"
              className={selectClass}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">{t('chooseSupplier')}</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {suppliers.isSuccess && activeSuppliers.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t('noSuppliers')}
              </p>
            ) : null}
          </div>
          <Field
            id="purchase-reference"
            label={t('fieldNames.supplierReference')}
            maxLength={60}
            autoComplete="off"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('goodsTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('goodsHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {lines.length > 0 ? (
            <ul className="grid gap-3" data-testid="purchase-lines">
              {lines.map((l, i) => {
                const unit = l.units.find((u) => u.id === l.unitId);
                return (
                  <li key={l.key} className="grid gap-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{l.productName}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((rows) =>
                            rows.filter((r) => r.key !== l.key),
                          )
                        }
                      >
                        {t('remove')}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="grid gap-2">
                        <Label htmlFor={`line-${l.key}-unit`}>
                          {t('unit')}
                        </Label>
                        <select
                          id={`line-${l.key}-unit`}
                          className={selectClass}
                          value={l.unitId}
                          onChange={(e) => {
                            const next = l.units.find(
                              (u) => u.id === e.target.value,
                            );
                            setLine(l.key, {
                              unitId: e.target.value,
                              unitCost:
                                l.unitCost === (unit?.buyingPrice ?? '')
                                  ? (next?.buyingPrice ?? '')
                                  : l.unitCost,
                            });
                          }}
                        >
                          {l.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Field
                        id={`line-${l.key}-quantity`}
                        label={t('quantity')}
                        inputMode="decimal"
                        autoComplete="off"
                        value={l.quantity}
                        onChange={(e) =>
                          setLine(l.key, { quantity: e.target.value })
                        }
                      />
                      <Field
                        id={`line-${l.key}-cost`}
                        label={t('unitCost', { unit: unit?.name ?? '' })}
                        inputMode="numeric"
                        autoComplete="off"
                        value={l.unitCost}
                        onChange={(e) =>
                          setLine(l.key, { unitCost: e.target.value })
                        }
                      />
                    </div>
                    <p
                      className="text-right text-sm"
                      data-testid={`line-total-${i}`}
                    >
                      {lineTotals[i] !== null ? money(lineTotals[i]) : '—'}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ProductPicker onPick={addProduct} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('chargesTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('chargesHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {charges.map((c) => (
            <div
              key={c.key}
              className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            >
              <Field
                id={`charge-${c.key}-description`}
                label={t('fieldNames.description')}
                maxLength={80}
                value={c.description}
                onChange={(e) =>
                  setCharge(c.key, { description: e.target.value })
                }
              />
              <Field
                id={`charge-${c.key}-amount`}
                label={t('fieldNames.amount')}
                inputMode="numeric"
                autoComplete="off"
                value={c.amount}
                onChange={(e) => setCharge(c.key, { amount: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setCharges((rows) => rows.filter((r) => r.key !== c.key))
                }
              >
                {t('remove')}
              </Button>
            </div>
          ))}
          {charges.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              className="justify-self-start"
              onClick={() =>
                setCharges((rows) => [
                  ...rows,
                  { key: nextKey(), description: '', amount: '' },
                ])
              }
            >
              {t('addCharge')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 py-4">
          <dl
            className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm"
            data-testid="purchase-totals"
          >
            <dt>{t('subtotal')}</dt>
            <dd className="text-right">
              {subtotal !== null ? money(subtotal) : '—'}
            </dd>
            <dt>{t('extraCosts')}</dt>
            <dd className="text-right">
              {extra !== null ? money(extra) : '—'}
            </dd>
            <dt className="font-semibold">{t('total')}</dt>
            <dd className="text-right font-semibold" data-testid="form-total">
              {total !== null ? money(total) : '—'}
            </dd>
          </dl>
          <Field
            id="purchase-note"
            label={t('fieldNames.note')}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {canReceive && canPay ? (
            <div className="grid gap-2 border-t pt-3">
              <p className="text-sm font-medium">{t('paidNowTitle')}</p>
              <PaymentFields
                id="paid-now"
                value={payment}
                onChange={setPayment}
                amountLabel={t('paidNow')}
              />
              <p className="text-muted-foreground text-xs">
                {t('paidNowHelp')}
              </p>
            </div>
          ) : null}
          {problem ? <Alert variant="destructive">{problem}</Alert> : null}
          {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            {canReceive ? (
              <Button
                type="button"
                disabled={pending}
                onClick={(e) => void submit(e, true)}
              >
                {t('saveAndReceive')}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant={canReceive ? 'outline' : 'default'}
              disabled={pending}
            >
              {t('saveDraft')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

/** Search by name, SKU or barcode, then tap a product to add a line. */
function ProductPicker({
  onPick,
}: {
  onPick: (product: ProductDetail, matchedUnitId: string | null) => void;
}) {
  const t = useTranslations('Purchases');
  const tErr = useTranslations('Errors');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: ({ signal }) =>
      apiFetch<{ products: ProductListItem[] }>(
        `/shops/current/products?limit=8&q=${encodeURIComponent(q)}`,
        { signal },
      ),
    enabled: q.length > 0,
  });

  const pick = async (item: ProductListItem) => {
    setError(null);
    setAdding(item.id);
    try {
      const product = await apiFetch<ProductDetail>(
        `/shops/current/products/${item.id}`,
      );
      onPick(product, item.matchedUnitId);
      setSearch('');
      setQ('');
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor="purchase-product-search">{t('addProduct')}</Label>
      <Input
        id="purchase-product-search"
        type="search"
        className="h-12 md:h-10"
        placeholder={t('productSearchPlaceholder')}
        autoComplete="off"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      {q && results.data ? (
        results.data.products.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noProducts')}</p>
        ) : (
          <ul
            className="grid divide-y rounded-md border"
            data-testid="product-results"
          >
            {results.data.products.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="hover:bg-muted/50 flex min-h-12 w-full items-center justify-between px-3 py-2 text-left"
                  disabled={adding !== null}
                  onClick={() => void pick(p)}
                >
                  <span>{p.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {p.sku ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
