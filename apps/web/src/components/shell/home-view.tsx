'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionInfo, ShopDetails } from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import {
  can,
  SESSION_KEY,
  useHasPendingInvitation,
  useSession,
} from '@/lib/session';

/**
 * Signed-in home. Which shop is shown is decided by the server-side session;
 * switching asks the API, which checks membership before accepting.
 */
export function HomeView() {
  const t = useTranslations('Home');
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.data === null) router.replace('/login');
  }, [session.data, router]);

  if (!session.data) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('loading')}
      </p>
    );
  }
  const info = session.data;

  return (
    <div className="grid w-full max-w-md gap-4">
      <header className="flex items-center justify-between gap-4">
        <p className="text-sm" data-testid="signed-in-as">
          {t('signedInAs', { name: info.user.fullName })}
        </p>
        <LogoutButton />
      </header>
      <PendingInvitation />
      {info.activeShopId ? <SubscriptionBanner info={info} /> : null}
      {info.user.isPlatformAdmin ? (
        <Button asChild variant="outline">
          <Link href="/platform">{t('platform')}</Link>
        </Button>
      ) : null}
      {info.memberships.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-xl font-semibold">{t('noShopsTitle')}</h1>
            </CardTitle>
            <CardDescription>{t('noShops')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/shops/new">{t('createShop')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : info.activeShopId ? (
        <ActiveShop info={info} />
      ) : (
        <ShopPicker info={info} />
      )}
    </div>
  );
}

function useSwitchShop() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const switchTo = async (shopId: string) => {
    setPending(true);
    try {
      await apiFetch('/auth/session/active-shop', {
        method: 'PUT',
        body: { shopId },
      });
      await queryClient.invalidateQueries();
    } finally {
      setPending(false);
    }
  };
  return { switchTo, pending };
}

function ShopPicker({ info }: { info: SessionInfo }) {
  const t = useTranslations('Home');
  const { switchTo, pending } = useSwitchShop();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold">{t('chooseTitle')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {info.memberships.map((m) => (
          <div
            key={m.shopId}
            className="flex min-h-12 items-center justify-between gap-4 border-b last:border-b-0"
          >
            <span>
              {m.shopName}{' '}
              <Badge variant="secondary">
                {m.isOwner ? t('owner') : t('staff')}
              </Badge>
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => void switchTo(m.shopId)}
            >
              {t('choose')}
            </Button>
          </div>
        ))}
        <Button asChild variant="link" className="justify-start px-0">
          <Link href="/shops/new">{t('newShop')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ActiveShop({ info }: { info: SessionInfo }) {
  const t = useTranslations();
  const { switchTo, pending } = useSwitchShop();
  const shop = useQuery({
    queryKey: ['shop', info.activeShopId],
    queryFn: ({ signal }) =>
      apiFetch<ShopDetails>('/shops/current', { signal }),
  });
  const membership = info.memberships.find(
    (m) => m.shopId === info.activeShopId,
  );

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('Home.activeShop')}</CardDescription>
        <CardTitle>
          <h1 className="text-xl font-semibold" data-testid="active-shop-name">
            {shop.data?.name ?? membership?.shopName}
          </h1>
        </CardTitle>
        {membership ? (
          <div>
            <Badge variant="secondary">
              {membership.isOwner ? t('Home.owner') : t('Home.staff')}
            </Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {shop.data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('Home.type')}</dt>
            <dd>{t(`BusinessTypes.${shop.data.businessType}`)}</dd>
            {shop.data.phone ? (
              <>
                <dt className="text-muted-foreground">{t('Home.phone')}</dt>
                <dd>{shop.data.phone}</dd>
              </>
            ) : null}
            {shop.data.address ? (
              <>
                <dt className="text-muted-foreground">{t('Home.address')}</dt>
                <dd>{shop.data.address}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('Home.currency')}</dt>
            <dd>{shop.data.currency}</dd>
          </dl>
        ) : null}
        {[
          'products.read',
          'inventory.read',
          'purchases.read',
          'suppliers.read',
        ].some((p) => can(info, p)) ? (
          <div className="grid grid-cols-2 gap-2">
            {can(info, 'products.read') ? (
              <Button asChild>
                <Link href="/products">{t('Home.products')}</Link>
              </Button>
            ) : null}
            {can(info, 'inventory.read') ? (
              <Button asChild variant="outline">
                <Link href="/inventory">{t('Home.inventory')}</Link>
              </Button>
            ) : null}
            {can(info, 'purchases.read') ? (
              <Button asChild variant="outline">
                <Link href="/purchases">{t('Home.purchases')}</Link>
              </Button>
            ) : null}
            {can(info, 'suppliers.read') ? (
              <Button asChild variant="outline">
                <Link href="/suppliers">{t('Home.suppliers')}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="text-muted-foreground text-sm">{t('Home.comingSoon')}</p>
        {info.memberships.length > 1 ? (
          <div className="grid gap-2">
            <Label htmlFor="shop-switcher">{t('Home.switchShop')}</Label>
            <select
              id="shop-switcher"
              className="border-input h-10 rounded-md border bg-transparent px-3 text-base md:text-sm"
              value={info.activeShopId ?? ''}
              disabled={pending}
              onChange={(e) => void switchTo(e.target.value)}
            >
              {info.memberships.map((m) => (
                <option key={m.shopId} value={m.shopId}>
                  {m.shopName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {can(info, 'users.read') ? (
          <Button asChild>
            <Link href="/team">{t('Home.team')}</Link>
          </Button>
        ) : null}
        {can(info, 'subscription.read') ? (
          <Button asChild variant="outline">
            <Link href="/subscription">{t('Home.subscription')}</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/shops/new">{t('Home.newShop')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Tells everyone in the shop when the subscription needs attention: the
 * trial is ending, the grace period has started, or the shop is read-only.
 * Only people who can pay see the link to pay.
 */
function SubscriptionBanner({ info }: { info: SessionInfo }) {
  const t = useTranslations('Home');
  const format = useFormatter();
  const sub = info.subscription;
  if (!sub) return null;
  const endsAt = new Date(sub.accessEndsAt);
  const date = format.dateTime(endsAt, { dateStyle: 'long' });
  let message: string | null = null;
  if (sub.status === 'RESTRICTED') message = t('bannerRestricted');
  else if (sub.status === 'GRACE') message = t('bannerGrace');
  else if (sub.endingSoon) {
    message =
      sub.status === 'TRIALING'
        ? t('bannerTrialEnding', { date })
        : t('bannerEnding', { date });
  }
  if (!message) return null;
  return (
    <Alert
      variant={sub.status === 'RESTRICTED' ? 'destructive' : 'default'}
      data-testid="subscription-banner"
    >
      {message}{' '}
      {can(info, 'subscription.read') ? (
        <Link className="underline" href="/subscription">
          {t('bannerAction')}
        </Link>
      ) : (
        t('bannerAskOwner')
      )}
    </Alert>
  );
}

/** Shown after signing in from an invitation link, to finish joining. */
function PendingInvitation() {
  const t = useTranslations('Home');
  if (!useHasPendingInvitation()) return null;
  return (
    <Alert>
      {t('pendingInvitation')}{' '}
      <Link className="underline" href="/invitations/accept">
        {t('openInvitation')}
      </Link>
    </Alert>
  );
}

function LogoutButton() {
  const t = useTranslations('Home');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await apiFetch('/auth/logout', { method: 'POST' });
        } finally {
          queryClient.setQueryData(SESSION_KEY, null);
          queryClient.removeQueries({
            predicate: (q) => q.queryKey[0] !== SESSION_KEY[0],
          });
          router.replace('/login');
        }
      }}
    >
      {t('logout')}
    </Button>
  );
}
