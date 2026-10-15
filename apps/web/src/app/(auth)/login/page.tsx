'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema, type LoginInput } from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthShell } from '@/components/forms/auth-shell';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { errorKey, SESSION_KEY } from '@/lib/session';

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await apiFetch('/auth/login', { method: 'POST', body: values });
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      router.replace('/');
    } catch (err) {
      setError(errorKey(err));
    }
  });

  return (
    <AuthShell
      title={t('Login.title')}
      description={t('Login.description')}
      footer={
        <p>
          {t('Login.noAccount')}{' '}
          <Link className="text-foreground underline" href="/register">
            {t('Login.register')}
          </Link>
        </p>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {error ? (
          <Alert variant="destructive">
            {t(`Errors.${error}`)}
            {error === 'email_not_verified' ? (
              <>
                {' '}
                <Link className="underline" href="/verify-email">
                  {t('Login.resend')}
                </Link>
              </>
            ) : null}
          </Alert>
        ) : null}
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
          autoComplete="current-password"
          label={t('Fields.password')}
          error={errors.password && t('Validation.passwordRequired')}
          {...form.register('password')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {t('Login.submit')}
        </Button>
        <Link
          className="text-muted-foreground text-sm underline"
          href="/forgot-password"
        >
          {t('Login.forgot')}
        </Link>
      </form>
    </AuthShell>
  );
}
