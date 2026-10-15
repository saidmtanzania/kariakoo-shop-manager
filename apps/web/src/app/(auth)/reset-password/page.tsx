'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema } from '@ksm/shared';
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

const formSchema = resetPasswordSchema.pick({ password: true });
type FormValues = { password: string };

export default function ResetPasswordPage() {
  const t = useTranslations();
  // undefined while reading the URL; null when the link has no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const read = useRef(false);

  useEffect(() => {
    // Reading clears the token from the URL, so read it once even in strict mode.
    if (read.current) return;
    read.current = true;
    void Promise.resolve(takeTokenFromHash()).then(setToken);
  }, []);

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await apiFetch('/auth/password/reset', {
        method: 'POST',
        body: { token, password },
      });
      setDone(true);
    } catch (err) {
      setError(errorKey(err));
    }
  });

  if (done) {
    return (
      <AuthShell title={t('ResetPassword.title')}>
        <div className="grid gap-4">
          <Alert>{t('ResetPassword.done')}</Alert>
          <Button asChild>
            <Link href="/login">{t('ResetPassword.login')}</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (token === null) {
    return (
      <AuthShell title={t('ResetPassword.title')}>
        <div className="grid gap-4">
          <Alert variant="destructive">{t('ResetPassword.missing')}</Alert>
          <Button asChild variant="outline">
            <Link href="/forgot-password">{t('ResetPassword.requestNew')}</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('ResetPassword.title')}
      description={t('ResetPassword.description')}
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error ? (
          <Alert variant="destructive">
            {t(`Errors.${error}`)}{' '}
            {error === 'invalid_or_expired_token' ? (
              <Link className="underline" href="/forgot-password">
                {t('ResetPassword.requestNew')}
              </Link>
            ) : null}
          </Alert>
        ) : null}
        <Field
          id="password"
          type="password"
          autoComplete="new-password"
          label={t('Fields.newPassword')}
          error={errors.password && t('Validation.password')}
          {...form.register('password')}
        />
        <Button type="submit" disabled={isSubmitting || token === undefined}>
          {t('ResetPassword.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
