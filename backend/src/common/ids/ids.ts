import { v7 as uuidv7 } from 'uuid';

/**
 * Generates a time-ordered UUID v7 for new records (decision A-008).
 * IDs are always generated server-side; client-generated UUIDs are used only
 * as idempotency keys (for example offline operation IDs).
 */
export function newId(): string {
  return uuidv7();
}
