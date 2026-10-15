'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  businessTypes,
  createShopSchema,
  type CreateShopInput,
  type ShopDetails,
} from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthShell } from '@/components/forms/auth-shell';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api';
import { errorKey } from '@/lib/session';

export default function NewShopPage() {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateShopInput>({
    resolver: zodResolver(createShopSchema),
    defaultValues: { name: '', phone: '', address: '', businessType: 'BOTH' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch<ShopDetails>('/shops', { method: 'POST', body: values });
      await queryClient.invalidateQueries();
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(errorKey(err));
    }
  });

  return (
    <AuthShell
      title={t('NewShop.title')}
      description={t('NewShop.description')}
      footer={
        <Link className="text-foreground underline" href="/">
          {t('NewShop.cancel')}
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error ? (
          <Alert variant="destructive">{t(`Errors.${error}`)}</Alert>
        ) : null}
        <Field
          id="name"
          label={t('Fields.shopName')}
          autoComplete="organization"
          error={errors.name && t('Validation.shopName')}
          {...form.register('name')}
        />
        <Field
          id="phone"
          type="tel"
          autoComplete="tel"
          label={t('Fields.phone')}
          error={errors.phone && t('Validation.phone')}
          {...form.register('phone')}
        />
        <Field
          id="address"
          label={t('Fields.address')}
          error={errors.address && t('Validation.address')}
          {...form.register('address')}
        />
        <div className="grid gap-2">
          <Label htmlFor="businessType">{t('Fields.businessType')}</Label>
          <select
            id="businessType"
            className="border-input h-10 rounded-md border bg-transparent px-3 text-base md:text-sm"
            {...form.register('businessType')}
          >
            {businessTypes.map((type) => (
              <option key={type} value={type}>
                {t(`BusinessTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {t('NewShop.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
