import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kariakoo Shop Manager',
  description: 'Sales, stock and credit management for Kariakoo shops.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
