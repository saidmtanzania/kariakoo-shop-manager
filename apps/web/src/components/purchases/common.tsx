'use client';

import {
  supplierPaymentMethods,
  type PurchaseStatus,
  type SupplierPaymentMethod,
} from '@ksm/shared';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/forms/field';
import { selectClass } from '@/components/products/products-view';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/money';

/** Money for display; null means hidden from this person (A-030). */
export const money = (v: string | null) =>
  v === null ? '—' : formatMoney(v, 'TZS');

/** People type "12,000" or "12 000"; the API takes digits only. */
export const cleanAmount = (v: string) => v.replace(/[,\s]/g, '');

export const optText = (v: string) => (v.trim() === '' ? null : v.trim());

export function StatusBadge({ status }: { status: PurchaseStatus }) {
  const t = useTranslations('Purchases');
  const variant =
    status === 'RECEIVED'
      ? 'success'
      : status === 'CANCELLED'
        ? 'destructive'
        : 'secondary';
  return (
    <Badge variant={variant} data-testid="purchase-status">
      {t(`statuses.${status}`)}
    </Badge>
  );
}

export interface PaymentInputState {
  amount: string;
  method: SupplierPaymentMethod;
  reference: string;
}

export const emptyPayment = (): PaymentInputState => ({
  amount: '',
  method: 'CASH',
  reference: '',
});

/** Amount, method and reference of a payment to a supplier. */
export function PaymentFields({
  id,
  value,
  onChange,
  amountLabel,
}: {
  id: string;
  value: PaymentInputState;
  onChange: (v: PaymentInputState) => void;
  amountLabel: string;
}) {
  const t = useTranslations('Suppliers');
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field
        id={`${id}-amount`}
        label={amountLabel}
        inputMode="numeric"
        autoComplete="off"
        value={value.amount}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
      />
      <div className="grid gap-2">
        <Label htmlFor={`${id}-method`}>{t('method')}</Label>
        <select
          id={`${id}-method`}
          className={selectClass}
          value={value.method}
          onChange={(e) =>
            onChange({
              ...value,
              method: e.target.value as SupplierPaymentMethod,
            })
          }
        >
          {supplierPaymentMethods.map((m) => (
            <option key={m} value={m}>
              {t(`methods.${m}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        id={`${id}-reference`}
        label={t('reference')}
        autoComplete="off"
        maxLength={60}
        value={value.reference}
        onChange={(e) => onChange({ ...value, reference: e.target.value })}
      />
    </div>
  );
}

/** The request body for a payment, or null when no amount was entered. */
export function paymentBody(p: PaymentInputState) {
  const amount = cleanAmount(p.amount);
  if (!amount) return null;
  return { amount, method: p.method, reference: optText(p.reference) };
}
