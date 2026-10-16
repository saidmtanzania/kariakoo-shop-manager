import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const BACKEND_SRC = resolve(import.meta.dirname, '../../backend/src');
/** The only file allowed to change stock balances or write movements. */
const LEDGER = 'modules/inventory/services/stock-ledger.service.ts';

const WRITES = [
  /\bstockBalance\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
  /\bstockMovement\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?stock_(balances|movements)\b/i,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === 'generated' ? [] : sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * AC-05: balances change only through the inventory ledger service, always
 * with a movement. A new place that writes them fails this test.
 */
describe('Stock ledger boundary', () => {
  it('finds stock writes only in the ledger service', () => {
    const offenders = sourceFiles(BACKEND_SRC)
      .map((path) => relative(BACKEND_SRC, path))
      .filter((path) => path !== LEDGER)
      .filter((path) => {
        const text = readFileSync(join(BACKEND_SRC, path), 'utf8');
        return WRITES.some((pattern) => pattern.test(text));
      });
    expect(offenders).toEqual([]);
  });

  it('still recognises the writes in the ledger service', () => {
    const text = readFileSync(join(BACKEND_SRC, LEDGER), 'utf8');
    expect(WRITES.filter((pattern) => pattern.test(text))).toHaveLength(3);
  });
});

/** The only file allowed to write supplier balances or ledger entries. */
const SUPPLIER_LEDGER = 'modules/suppliers/services/supplier-ledger.service.ts';

const SUPPLIER_WRITES = [
  /\bsupplierLedgerEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
  /\bdata:\s*\{[^}]*\bbalance\b/,
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(suppliers|supplier_ledger_entries)\b/i,
];

/**
 * AC-06: supplier balances change only through the supplier ledger
 * service, always with a ledger entry.
 */
describe('Supplier ledger boundary', () => {
  const writers = (paths: string[]) =>
    paths.filter((path) => {
      const text = readFileSync(join(BACKEND_SRC, path), 'utf8');
      return SUPPLIER_WRITES.some((pattern) => pattern.test(text));
    });

  it('finds supplier balance writes only in the supplier ledger service', () => {
    const services = sourceFiles(BACKEND_SRC)
      .map((path) => relative(BACKEND_SRC, path))
      .filter((path) => path.startsWith('modules/') && path !== SUPPLIER_LEDGER)
      .filter((path) => path.includes('/services/'));
    expect(writers(services)).toEqual([]);
  });

  it('still recognises the writes in the supplier ledger service', () => {
    const text = readFileSync(join(BACKEND_SRC, SUPPLIER_LEDGER), 'utf8');
    expect(
      SUPPLIER_WRITES.filter((pattern) => pattern.test(text)),
    ).toHaveLength(2);
  });
});
