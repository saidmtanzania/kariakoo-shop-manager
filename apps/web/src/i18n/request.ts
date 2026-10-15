import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from './config';

// Locale selection (user preference or shop setting) arrives with
// authentication in Phase 02. Until then every request uses the default.
export default getRequestConfig(async () => {
  const locale = defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Africa/Dar_es_Salaam',
  };
});
