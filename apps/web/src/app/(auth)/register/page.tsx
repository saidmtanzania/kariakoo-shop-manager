'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@ksm/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthShell } from '@/components/forms/auth-shell';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { errorKey } from '@/lib/session';

export default function RegisterPage() {
  const t = useTranslations();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch('/auth/register', { method: 'POST', body: values });
      setSentTo(values.email);
    } catch (err) {
      setError(errorKey(err));
    }
  });

  if (sentTo) {
    return (
      <AuthShell title={t('Register.sentTitle')}>
        <Alert>{t('Register.sent', { email: sentTo })}</Alert>
        <Button asChild variant="link" className="mt-2 px-0">
          <Link href="/login">{t('Register.login')}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('Register.title')}
      description={t('Register.description')}
      footer={
        <p>
          {t('Register.hasAccount')}{' '}
          <Link className="text-foreground underline" href="/login">
            {t('Register.login')}
          </Link>
        </p>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error ? (
          <Alert variant="destructive">{t(`Errors.${error}`)}</Alert>
        ) : null}
        <Field
          id="fullName"
          autoComplete="name"
          label={t('Fields.fullName')}
          error={errors.fullName && t('Validation.fullName')}
          {...form.register('fullName')}
        />
        <Field
          id="email"
          type="email"
          autoComplete="email"
          label={t('Fields.email')}
          error={errors.email && t('Validation.email')}
          {...form.register('email')}
        />
        <Field
          id="password"
          type="password"
          autoComplete="new-password"
          label={t('Fields.password')}
          error={errors.password && t('Validation.password')}
          {...form.register('password')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {t('Register.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
