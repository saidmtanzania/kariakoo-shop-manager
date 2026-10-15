import { z } from 'zod';

/**
 * Money travels over the API as a decimal string, never a JS number
 * (decision A-008). Up to 2 decimal places, matching numeric(18,2).
 */
export const moneyStringSchema = z
  .string()
  .regex(
    /^-?\d{1,16}(\.\d{1,2})?$/,
    'Must be a decimal amount with at most 2 decimal places',
  );

/**
 * Quantities travel as decimal strings with up to 3 decimal places,
 * matching numeric(18,3).
 */
export const quantityStringSchema = z
  .string()
  .regex(
    /^-?\d{1,15}(\.\d{1,3})?$/,
    'Must be a decimal quantity with at most 3 decimal places',
  );
