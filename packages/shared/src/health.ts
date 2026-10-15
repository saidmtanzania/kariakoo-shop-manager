import { z } from 'zod';

/** Response of GET /api/v1/health/ready. */
export const readinessSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
  timestamp: z.iso.datetime(),
});

export type Readiness = z.infer<typeof readinessSchema>;

/** Response of GET /api/v1/health. */
export const livenessSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export type Liveness = z.infer<typeof livenessSchema>;
