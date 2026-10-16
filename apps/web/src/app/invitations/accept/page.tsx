'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { InvitationPreview } from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/forms/auth-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import {
  errorKey,
  readInvitationToken,
  SESSION_KEY,
  storeInvitationToken,
  takeTokenFromHash,
  useSession,
} from '@/lib/session';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; code: string }
  | { kind: 'ready'; token: string; preview: InvitationPreview };

const RETURN_PATH = '/invitations/accept';

/**
 * Opened from the invitation email. The token stays in this tab while the
 * invitee signs in or creates an account, then they come back here.
 */
export default function AcceptInvitationPage() {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeTokenFromHash() ?? readInvitationToken();
    if (!token) {
      void Promise.resolve<State>({ kind: 'missing' }).then(setState);
      return;
    }
    storeInvitationToken(token);
    void apiFetch<InvitationPreview>('/invitations/preview', {
      method: 'POST',
      body: { token },
    }).then(
      (preview) => {
        if (preview.status !== 'PENDING') storeInvitationToken(null);
        setState(
          preview.status === 'PENDING'
            ? { kind: 'ready', token, preview }
            : {
                kind: 'error',
                code: `invitation_${preview.status === 'ACCEPTED' ? 'used' : preview.status.toLowerCase()}`,
              },
        );
      },
      (err: unknown) => {
        storeInvitationToken(null);
        setState({ kind: 'error', code: errorKey(err) });
      },
    );
  }, []);

  const accept = async (token: string) => {
    setAcceptError(null);
    setPending(true);
    try {
      await apiFetch('/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      storeInvitationToken(null);
      await queryClient.invalidateQueries();
      router.replace('/');
    } catch (err) {
      setAcceptError(errorKey(err));
      setPending(false);
    }
  };

  const signOut = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.setQueryData(SESSION_KEY, null);
  };

  return (
    <AuthShell title={t('AcceptInvitation.title')}>
      {state.kind === 'loading' || session.isPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('AcceptInvitation.loading')}
        </p>
      ) : state.kind === 'missing' ? (
        <Alert variant="destructive">{t('AcceptInvitation.missing')}</Alert>
      ) : state.kind === 'error' ? (
        <Alert variant="destructive">{t(`Errors.${state.code}`)}</Alert>
      ) : (
        <div className="grid gap-4">
          <p data-testid="invitation-summary">
            {state.preview.invitedBy
              ? t('AcceptInvitation.invited', {
                  inviter: state.preview.invitedBy,
                  shop: state.preview.shopName,
                })
              : t('AcceptInvitation.invitedNoName', {
                  shop: state.preview.shopName,
                })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('AcceptInvitation.sentTo', { email: state.preview.email })}
          </p>
          {acceptError ? (
            <Alert variant="destructive">{t(`Errors.${acceptError}`)}</Alert>
          ) : null}
          {!session.data ? (
            <>
              <Alert>
                {t('AcceptInvitation.signInFirst', {
                  email: state.preview.email,
                })}
              </Alert>
              <Button asChild>
                <Link href={`/login?next=${encodeURIComponent(RETURN_PATH)}`}>
                  {t('AcceptInvitation.signIn')}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/register">{t('AcceptInvitation.register')}</Link>
              </Button>
            </>
          ) : session.data.user.email.toLowerCase() !==
            state.preview.email.toLowerCase() ? (
            <>
              <Alert variant="destructive">
                {t('AcceptInvitation.wrongAccount', {
                  email: session.data.user.email,
                })}
              </Alert>
              <Button variant="outline" onClick={() => void signOut()}>
                {t('AcceptInvitation.signOut')}
              </Button>
            </>
          ) : (
            <Button disabled={pending} onClick={() => void accept(state.token)}>
              {t('AcceptInvitation.accept')}
            </Button>
          )}
        </div>
      )}
    </AuthShell>
  );
}
