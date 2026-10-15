export const locales = ['en', 'sw'] as const;
export type Locale = (typeof locales)[number];

/** English first; Kiswahili is wired in so every string is translatable. */
export const defaultLocale: Locale = 'en';
