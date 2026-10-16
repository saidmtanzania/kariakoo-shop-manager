'use client';

import type { SessionInfo } from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';

/**
 * The signed-in session with an active shop, or null while loading.
 * Signed-out visitors go to sign-in (and come back); people without an
 * active shop go home to choose one.
 */
export function useShopSession(next: string): SessionInfo | null {
  const router = useRouter();
  const session = useSession();
  useEffect(() => {
    if (session.data === null)
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    else if (session.data && !session.data.activeShopId) router.replace('/');
  }, [session.data, router, next]);
  return session.data?.activeShopId ? session.data : null;
}

export function Loading() {
  const t = useTranslations('Home');
  return (
    <p className="text-muted-foreground text-sm" role="status">
      {t('loading')}
    </p>
  );
}

/** Page title with a back link and optional actions. */
export function PageHeader({
  title,
  back,
  backLabel,
  children,
}: {
  title: string;
  back: string;
  backLabel: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        {children}
        <Button asChild variant="ghost" size="sm">
          <Link href={back}>{backLabel}</Link>
        </Button>
      </div>
    </header>
  );
}
