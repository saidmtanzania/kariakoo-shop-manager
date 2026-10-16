import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and verifies the right password only', async () => {
    const stored = await service.hash('correct horse battery');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    await expect(service.verify(stored, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(service.verify(stored, 'wrong password')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await service.hash('same password')).not.toBe(
      await service.hash('same password'),
    );
  });

  it('returns false for an unknown user after doing equivalent work', async () => {
    await expect(service.verify(null, 'anything')).resolves.toBe(false);
  });

  it('returns false for a malformed stored hash', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
