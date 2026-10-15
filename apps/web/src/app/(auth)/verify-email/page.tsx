'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { emailOnlySchema, type EmailOnlyInput } from '@ksm/shared';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthShell } from '@/components/forms/auth-shell';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { errorKey, takeTokenFromHash } from '@/lib/session';

type State = 'verifying' | 'done' | 'missing' | { error: string };

export default function VerifyEmailPage() {
  const t = useTranslations();
  const [state, setState] = useState<State>('verifying');
  const started = useRef(false);

  useEffect(() => {
    // The token is single-use, so verify exactly once even in strict mode.
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromHash();
    const result: Promise<State> = token
      ? apiFetch('/auth/verify-email', {
          method: 'POST',
          body: { token },
        }).then(
          () => 'done' as const,
          (err: unknown) => ({ error: errorKey(err) }),
        )
      : Promise.resolve('missing');
    void result.then(setState);
  }, []);

  return (
    <AuthShell title={t('VerifyEmail.title')}>
      {state === 'verifying' ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('VerifyEmail.verifying')}
        </p>
      ) : state === 'done' ? (
        <div className="grid gap-4">
          <Alert>{t('VerifyEmail.done')}</Alert>
          <Button asChild>
            <Link href="/login">{t('VerifyEmail.login')}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <Alert variant="destructive">
            {state === 'missing'
              ? t('VerifyEmail.missing')
              : t(`Errors.${state.error}`)}
          </Alert>
          <ResendForm />
        </div>
      )}
    </AuthShell>
  );
}

function ResendForm() {
  const t = useTranslations();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<EmailOnlyInput>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch('/auth/resend-verification', {
        method: 'POST',
        body: values,
      });
      setSent(true);
    } catch (err) {
      setError(errorKey(err));
    }
  });

  if (sent) return <Alert>{t('VerifyEmail.resent')}</Alert>;
  return (
    <form className="grid gap-4" onSubmit={onSubmit} noValidate>
      <h2 className="text-sm font-medium">{t('VerifyEmail.resendTitle')}</h2>
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
      <Button type="submit" variant="outline" disabled={isSubmitting}>
        {t('VerifyEmail.resend')}
      </Button>
    </form>
  );
}
