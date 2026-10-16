'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  productCreateSchema,
  type CategoryView,
  type ProductCreateInput,
  type ProductDetail,
  type SessionInfo,
} from '@ksm/shared';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { can, errorKey } from '@/lib/session';
import { selectClass } from './products-view';

interface UnitRow {
  key: number;
  name: string;
  conversion: string;
  barcode: string;
  retailPrice: string;
  wholesalePrice: string;
  buyingPrice: string;
  allowFraction: boolean;
}

const emptyUnit = (key: number): UnitRow => ({
  key,
  name: '',
  conversion: '',
  barcode: '',
  retailPrice: '',
  wholesalePrice: '',
  buyingPrice: '',
  allowFraction: false,
});

/** Whether this person may see and enter buying prices and costs. */
export const canSeeCosts = (info: SessionInfo) =>
  can(info, 'products.prices.update') || can(info, 'reports.profit.read');

const opt = (v: string) => (v.trim() === '' ? null : v.trim());

/** Add a product with its units, prices and (optionally) opening stock. */
export function NewProductView() {
  const t = useTranslations('Products');
  const info = useShopSession('/products/new');
  if (!info) return <Loading />;
  return (
    <div className="grid w-full max-w-2xl gap-4">
      <PageHeader
        title={t('newTitle')}
        back="/products"
        backLabel={t('cancel')}
      />
      {can(info, 'products.create') ? (
        <NewProductForm info={info} />
      ) : (
        <Alert>{t('noCreate')}</Alert>
      )}
    </div>
  );
}

function NewProductForm({ info }: { info: SessionInfo }) {
  const t = useTranslations('Products');
  const tErr = useTranslations('Errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const costs = canSeeCosts(info);
  const opening = can(info, 'inventory.opening');

  const categories = useQuery({
    queryKey: ['product-categories'],
    queryFn: ({ signal }) =>
      apiFetch<{ categories: CategoryView[] }>(
        '/shops/current/product-categories',
        { signal },
      ),
  });

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [sku, setSku] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [base, setBase] = useState<UnitRow>({
    ...emptyUnit(0),
    name: '',
    conversion: '1',
  });
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [openingUnit, setOpeningUnit] = useState('');
  const [openingQty, setOpeningQty] = useState('');
  const [openingCost, setOpeningCost] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const unitNames = [base.name, ...units.map((u) => u.name)]
    .map((n) => n.trim())
    .filter(Boolean);

  const setUnit = (key: number, patch: Partial<UnitRow>) =>
    setUnits((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setError(null);
    const prices = (u: UnitRow) => ({
      retailPrice: opt(u.retailPrice),
      wholesalePrice: opt(u.wholesalePrice),
      ...(costs ? { buyingPrice: opt(u.buyingPrice) } : {}),
    });
    const body: ProductCreateInput = {
      name,
      sku: opt(sku),
      reorderLevel: opt(reorderLevel),
      categoryId: categoryId && categoryId !== 'new' ? categoryId : null,
      baseUnit: {
        name: base.name,
        allowFraction: base.allowFraction,
        barcode: opt(base.barcode),
        ...prices(base),
      },
      units: units.map((u) => ({
        name: u.name,
        conversion: u.conversion.trim(),
        allowFraction: u.allowFraction,
        barcode: opt(u.barcode),
        ...prices(u),
      })),
      openingStock:
        opening && opt(openingQty)
          ? {
              unitName: openingUnit || base.name,
              quantity: openingQty.trim(),
              unitCost: costs ? opt(openingCost) : null,
            }
          : null,
    };
    const parsed = productCreateSchema.safeParse(body);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path ?? [];
      const field = String(
        path.find(
          (p) => typeof p === 'string' && p !== 'units' && p !== 'baseUnit',
        ) ?? 'name',
      );
      setProblem(
        t('fix', {
          field: t.has(`fieldNames.${field}`)
            ? t(`fieldNames.${field}`)
            : t('fieldNames.other'),
        }),
      );
      return;
    }
    setPending(true);
    try {
      if (categoryId === 'new' && newCategory.trim()) {
        const cat = await apiFetch<CategoryView>(
          '/shops/current/product-categories',
          { method: 'POST', body: { name: newCategory.trim() } },
        );
        body.categoryId = cat.id;
      }
      const created = await apiFetch<ProductDetail>('/shops/current/products', {
        method: 'POST',
        body,
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      router.push(`/products/${created.id}`);
    } catch (err) {
      setError(errorKey(err));
      setPending(false);
    }
  };

  const priceFields = (
    u: UnitRow,
    onChange: (p: Partial<UnitRow>) => void,
    id: string,
  ) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field
        id={`${id}-retail`}
        label={t('retailPrice')}
        inputMode="numeric"
        value={u.retailPrice}
        onChange={(e) => onChange({ retailPrice: e.target.value })}
      />
      <Field
        id={`${id}-wholesale`}
        label={t('wholesalePrice')}
        inputMode="numeric"
        value={u.wholesalePrice}
        onChange={(e) => onChange({ wholesalePrice: e.target.value })}
      />
      {costs ? (
        <Field
          id={`${id}-buying`}
          label={t('buyingPrice')}
          inputMode="numeric"
          value={u.buyingPrice}
          onChange={(e) => onChange({ buyingPrice: e.target.value })}
        />
      ) : null}
    </div>
  );

  return (
    <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('details')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field
            id="product-name"
            label={t('fields.name')}
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="product-category-select">{t('category')}</Label>
              <select
                id="product-category-select"
                className={selectClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t('noCategory')}</option>
                {(categories.data?.categories ?? [])
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                {can(info, 'products.update') ? (
                  <option value="new">{t('newCategory')}</option>
                ) : null}
              </select>
            </div>
            {categoryId === 'new' ? (
              <Field
                id="new-category"
                label={t('newCategoryName')}
                value={newCategory}
                maxLength={60}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            ) : null}
            <Field
              id="product-sku"
              label={t('fields.sku')}
              value={sku}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold">{t('baseUnitTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('baseUnitHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="base-unit-name"
              label={t('fields.unitName')}
              placeholder={t('baseUnitPlaceholder')}
              value={base.name}
              maxLength={40}
              onChange={(e) => setBase({ ...base, name: e.target.value })}
            />
            <Field
              id="base-unit-barcode"
              label={t('fields.barcode')}
              inputMode="numeric"
              value={base.barcode}
              maxLength={64}
              autoComplete="off"
              onChange={(e) => setBase({ ...base, barcode: e.target.value })}
            />
          </div>
          <label className="flex min-h-12 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={base.allowFraction}
              onChange={(e) =>
                setBase({ ...base, allowFraction: e.target.checked })
              }
            />
            {t('allowFraction')}
          </label>
          {priceFields(base, (p) => setBase({ ...base, ...p }), 'base')}
          <Field
            id="reorder-level"
            label={t('fields.reorderLevel', {
              unit: base.name || t('baseUnitShort'),
            })}
            inputMode="decimal"
            value={reorderLevel}
            onChange={(e) => setReorderLevel(e.target.value)}
          />
        </CardContent>
      </Card>

      {units.map((u, i) => (
        <Card key={u.key} data-testid={`unit-row-${i}`}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>
                <h2 className="text-lg font-semibold">
                  {t('otherUnitTitle', { number: i + 1 })}
                </h2>
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setUnits((rows) => rows.filter((r) => r.key !== u.key))
                }
              >
                {t('removeUnit')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                id={`unit-${i}-name`}
                label={t('fields.unitName')}
                placeholder={t('unitPlaceholder')}
                value={u.name}
                maxLength={40}
                onChange={(e) => setUnit(u.key, { name: e.target.value })}
              />
              <Field
                id={`unit-${i}-conversion`}
                label={t('fields.conversion', {
                  unit: base.name || t('baseUnitShort'),
                })}
                inputMode="decimal"
                value={u.conversion}
                onChange={(e) => setUnit(u.key, { conversion: e.target.value })}
              />
              <Field
                id={`unit-${i}-barcode`}
                label={t('fields.barcode')}
                inputMode="numeric"
                value={u.barcode}
                maxLength={64}
                autoComplete="off"
                onChange={(e) => setUnit(u.key, { barcode: e.target.value })}
              />
            </div>
            <label className="flex min-h-12 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5"
                checked={u.allowFraction}
                onChange={(e) =>
                  setUnit(u.key, { allowFraction: e.target.checked })
                }
              />
              {t('allowFraction')}
            </label>
            {priceFields(u, (p) => setUnit(u.key, p), `unit-${i}`)}
          </CardContent>
        </Card>
      ))}
      {units.length < 9 ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setUnits((rows) => [...rows, emptyUnit(Date.now())])}
        >
          {t('addUnit')}
        </Button>
      ) : null}

      {opening ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-lg font-semibold">{t('openingTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('openingHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field
              id="opening-quantity"
              label={t('fields.quantity')}
              inputMode="decimal"
              value={openingQty}
              onChange={(e) => setOpeningQty(e.target.value)}
            />
            <div className="grid gap-2">
              <Label htmlFor="opening-unit">{t('fields.unit')}</Label>
              <select
                id="opening-unit"
                className={selectClass}
                value={openingUnit}
                onChange={(e) => setOpeningUnit(e.target.value)}
              >
                {unitNames.map((n) => (
                  <option key={n} value={n === unitNames[0] ? '' : n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {costs ? (
              <Field
                id="opening-cost"
                label={t('fields.unitCost')}
                inputMode="numeric"
                value={openingCost}
                onChange={(e) => setOpeningCost(e.target.value)}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {problem ? <Alert variant="destructive">{problem}</Alert> : null}
      {error ? <Alert variant="destructive">{tErr(error)}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
