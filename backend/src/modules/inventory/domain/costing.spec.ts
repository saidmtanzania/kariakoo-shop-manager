import {
  averageAfterReceipt,
  averageAfterRemoval,
  costPerBaseUnit,
} from './costing.js';

describe('weighted-average costing (D-003)', () => {
  it('follows the worked example in the data model', () => {
    // 24 pieces @ 1,800 + 2 cartons (24 pieces) @ 1,800 → 1,800.
    const a1 = averageAfterReceipt(
      { quantity: '24', averageCost: '1800' },
      { quantity: '24', unitCost: '1800' },
    );
    expect(a1).toBe('1800.0000');
    // + 1 carton (12 pieces) @ 2,000 → (48·1,800 + 12·2,000) / 60 = 1,840.
    expect(
      averageAfterReceipt(
        { quantity: '48', averageCost: a1 },
        { quantity: '12', unitCost: '2000' },
      ),
    ).toBe('1840.0000');
  });

  it('takes the new cost when nothing (or less than nothing) is on hand', () => {
    expect(
      averageAfterReceipt(
        { quantity: '0', averageCost: '900' },
        { quantity: '5', unitCost: '1000' },
      ),
    ).toBe('1000.0000');
    expect(
      averageAfterReceipt(
        { quantity: '-3', averageCost: '900' },
        { quantity: '5', unitCost: '1000' },
      ),
    ).toBe('1000.0000');
  });

  it('rounds half-up at 4 decimals', () => {
    // (1·1 + 2·2) / 3 = 1.66666… → 1.6667
    expect(
      averageAfterReceipt(
        { quantity: '1', averageCost: '1' },
        { quantity: '2', unitCost: '2' },
      ),
    ).toBe('1.6667');
    // fractional quantities: (0.5·100 + 0.25·400) / 0.75 = 200
    expect(
      averageAfterReceipt(
        { quantity: '0.5', averageCost: '100' },
        { quantity: '0.25', unitCost: '400' },
      ),
    ).toBe('200.0000');
  });

  it('converts a unit cost to a cost per base unit', () => {
    expect(costPerBaseUnit('21600', '12')).toBe('1800.0000');
    expect(costPerBaseUnit('1000', '3')).toBe('333.3333');
    expect(costPerBaseUnit('2000', '3')).toBe('666.6667');
    expect(costPerBaseUnit('5000', '0.5')).toBe('10000.0000');
  });
});

describe('cancelling a receipt (averageAfterRemoval)', () => {
  it('undoes the receipt exactly when nothing else happened', () => {
    const after = averageAfterReceipt(
      { quantity: '48', averageCost: '1800' },
      { quantity: '12', unitCost: '2000' },
    );
    expect(after).toBe('1840.0000');
    expect(
      averageAfterRemoval(
        { quantity: '60', averageCost: after },
        { quantity: '12', unitCost: '2000' },
      ),
    ).toBe('1800.0000');
  });

  it('keeps the average when no stock is left', () => {
    expect(
      averageAfterRemoval(
        { quantity: '12', averageCost: '2000' },
        { quantity: '12', unitCost: '2000' },
      ),
    ).toBe('2000.0000');
  });

  it('never goes below zero', () => {
    expect(
      averageAfterRemoval(
        { quantity: '20', averageCost: '100' },
        { quantity: '10', unitCost: '500' },
      ),
    ).toBe('0.0000');
  });
});
