import { newId } from './ids.js';

describe('newId', () => {
  it('returns UUID v7 values', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is time-ordered so B-tree inserts stay sequential', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
