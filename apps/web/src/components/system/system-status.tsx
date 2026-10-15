'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchReadiness } from '@/lib/api';

type State = 'checking' | 'connected' | 'disconnected';

function StatusRow({
  label,
  state,
  testId,
}: {
  label: string;
  state: State;
  testId: string;
}) {
  const t = useTranslations('SystemStatus');
  const variant =
    state === 'connected'
      ? 'success'
      : state === 'checking'
        ? 'secondary'
        : 'destructive';
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-sm">{label}</span>
      <Badge
        variant={variant}
        data-testid={testId}
        data-state={state}
        aria-live="polite"
      >
        {t(state)}
      </Badge>
    </div>
  );
}

export function SystemStatus() {
  const t = useTranslations('SystemStatus');
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => fetchReadiness(signal),
    retry: false,
  });

  const api: State = isPending
    ? 'checking'
    : isError
      ? 'disconnected'
      : 'connected';
  const database: State = isPending
    ? 'checking'
    : data?.checks.database === 'up'
      ? 'connected'
      : 'disconnected';

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <StatusRow label={t('api')} state={api} testId="status-api" />
        <StatusRow
          label={t('database')}
          state={database}
          testId="status-database"
        />
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-4 min-h-11 w-full rounded-md border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? t('checking') : t('retry')}
        </button>
      </CardContent>
    </Card>
  );
}
