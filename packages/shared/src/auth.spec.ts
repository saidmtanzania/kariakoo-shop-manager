import {
  createShopSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.js';

describe('registerSchema', () => {
  it('accepts a valid registration and trims the name', () => {
    const parsed = registerSchema.parse({
      fullName: '  Asha Mussa ',
      email: 'asha@example.co.tz',
      password: 'correct horse',
    });
    expect(parsed.fullName).toBe('Asha Mussa');
  });

  it('rejects short passwords and bad emails', () => {
    expect(
      registerSchema.safeParse({
        fullName: 'A',
        email: 'a@b.co',
        password: 'short',
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        fullName: 'A',
        email: 'not-an-email',
        password: 'long enough',
      }).success,
    ).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('requires a plausible token', () => {
    expect(
      resetPasswordSchema.safeParse({ token: 'x', password: 'long enough' })
        .success,
    ).toBe(false);
  });
});

describe('createShopSchema', () => {
  it('defaults the business type to BOTH', () => {
    expect(createShopSchema.parse({ name: 'Duka la Asha' }).businessType).toBe(
      'BOTH',
    );
  });
});
