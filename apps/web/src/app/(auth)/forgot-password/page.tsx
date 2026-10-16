'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { emailOnlySchema, type EmailOnlyInput } from '@ksm/shared';
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

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EmailOnlyInput>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch('/auth/password/forgot', { method: 'POST', body: values });
      setSentTo(values.email);
    } catch (err) {
      setError(errorKey(err));
    }
  });

  const back = (
    <Link className="text-foreground underline" href="/login">
      {t('ForgotPassword.back')}
    </Link>
  );

  return (
    <AuthShell
      title={t('ForgotPassword.title')}
      description={sentTo ? undefined : t('ForgotPassword.description')}
      footer={back}
    >
      {sentTo ? (
        <Alert>{t('ForgotPassword.sent', { email: sentTo })}</Alert>
      ) : (
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {error ? (
            <Alert variant="destructive">{t(`Errors.${error}`)}</Alert>
          ) : null}
          <Field
            id="email"
            type="email"
            autoComplete="email"
            label={t('Fields.email')}
            error={errors.email && t('Validation.email')}
            {...form.register('email')}
          />
          <Button type="submit" disabled={isSubmitting}>
            {t('ForgotPassword.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
