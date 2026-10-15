import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Centred card used by the sign-in, registration and recovery pages. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations('App');
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      <p className="text-muted-foreground text-sm font-medium">{t('name')}</p>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{title}</h1>
          </CardTitle>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer ? (
          <CardFooter className="text-muted-foreground flex-col items-start gap-2 text-sm">
            {footer}
          </CardFooter>
        ) : null}
      </Card>
    </main>
  );
}
