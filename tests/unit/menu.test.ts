import { describe, it, expect } from 'vitest';
import {
  validateOrderItems,
  getMealPeriod,
  getClosedReason,
  isOrtegaOpen,
  LUNCH_ENTREES,
  DINNER_EXTRA_ENTREES,
  SIDES,
  DESSERTS,
  FRUITS,
  OrderItems,
} from '../../src/lib/menu';

const BASE: OrderItems = {
  entree:     'Classic Burger',
  side:       null,
  dessert:    null,
  fruits:     [],
  beverage:   null,
  condiments: [],
  notes:      null,
};

describe('validateOrderItems', () => {
  it('passes a minimal valid order (lunch)', () => {
    const r = validateOrderItems(BASE, 'lunch');
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('requires an entree', () => {
    const r = validateOrderItems({ ...BASE, entree: '' }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/entree/i);
  });

  it('rejects an entree not on the menu', () => {
    const r = validateOrderItems({ ...BASE, entree: 'Pizza' }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not on the lunch menu/i);
  });

  it('dinner special available at dinner', () => {
    const r = validateOrderItems({ ...BASE, entree: DINNER_EXTRA_ENTREES[0] }, 'dinner');
    expect(r.ok).toBe(true);
  });

  it('dinner special NOT available at lunch', () => {
    const r = validateOrderItems({ ...BASE, entree: DINNER_EXTRA_ENTREES[0] }, 'lunch');
    expect(r.ok).toBe(false);
  });

  it('allows max 2 fruits with no dessert', () => {
    const r = validateOrderItems({ ...BASE, fruits: [FRUITS[0], FRUITS[1]] }, 'lunch');
    expect(r.ok).toBe(true);
  });

  it('rejects 3 fruits with no dessert', () => {
    const r = validateOrderItems({ ...BASE, fruits: [...FRUITS] }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 2 fruits/i);
  });

  it('allows only 1 fruit when dessert chosen', () => {
    const ok = validateOrderItems({ ...BASE, dessert: DESSERTS[0], fruits: [FRUITS[0]] }, 'lunch');
    expect(ok.ok).toBe(true);
    const bad = validateOrderItems({ ...BASE, dessert: DESSERTS[0], fruits: [FRUITS[0], FRUITS[1]] }, 'lunch');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/max 1 fruit/i);
  });

  it('rejects invalid side', () => {
    const r = validateOrderItems({ ...BASE, side: 'Garlic Bread' }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/invalid side/i);
  });

  it('accepts a valid side', () => {
    const r = validateOrderItems({ ...BASE, side: SIDES[0] }, 'lunch');
    expect(r.ok).toBe(true);
  });

  it('rejects invalid fruit', () => {
    const r = validateOrderItems({ ...BASE, fruits: ['Mango'] }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/invalid fruit/i);
  });

  it('full order passes', () => {
    const r = validateOrderItems({
      entree:     'Classic Burger',
      side:       SIDES[0],
      dessert:    DESSERTS[0],
      fruits:     [FRUITS[0]],
      beverage:   'Water',
      condiments: ['Ketchup (vgn)', 'Mustard Packet (vgn)'],
      notes:      'No onions please',
    }, 'dinner');
    expect(r.ok).toBe(true);
  });
});

describe('getMealPeriod / hours', () => {
  const makeDate = (day: number, hour: number) => {
    // day=1 Mon … day=5 Fri, day=0 Sun, day=6 Sat
    // Use a fixed Monday in LA timezone
    const d = new Date('2024-01-08T12:00:00-08:00'); // Mon Jan 8 2024 noon PT
    d.setDate(d.getDate() + day);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  // We pass the date directly to the function and rely on LA conversion
  it('returns closed on Saturday', () => {
    // Sat = day 6
    const sat = new Date('2024-01-13T12:00:00-08:00');
    expect(getClosedReason(sat)).toMatch(/weekend/i);
    expect(isOrtegaOpen(sat)).toBe(false);
  });

  it('returns closed on Sunday', () => {
    const sun = new Date('2024-01-14T14:00:00-08:00');
    expect(isOrtegaOpen(sun)).toBe(false);
  });

  it('returns lunch during 10am-3pm on a weekday', () => {
    const mon10am = new Date('2024-01-08T10:30:00-08:00');
    expect(getMealPeriod(mon10am)).toBe('lunch');
  });

  it('returns dinner during 3pm-8pm on a weekday', () => {
    const mon5pm = new Date('2024-01-08T17:00:00-08:00');
    expect(getMealPeriod(mon5pm)).toBe('dinner');
  });

  it('returns closed before 10am', () => {
    const mon9am = new Date('2024-01-08T09:00:00-08:00');
    expect(getMealPeriod(mon9am)).toBe('closed');
    expect(getClosedReason(mon9am)).toMatch(/opens at 10/i);
  });

  it('returns closed after 8pm', () => {
    const mon9pm = new Date('2024-01-08T21:00:00-08:00');
    expect(getMealPeriod(mon9pm)).toBe('closed');
    expect(getClosedReason(mon9pm)).toMatch(/closes at 8/i);
  });
});

// ── Multiset fruit tests ───────────────────────────────────────────────────
describe('fruit multiset (duplicates allowed)', () => {
  it('allows two of the same fruit with no dessert', () => {
    const r = validateOrderItems({ ...BASE, fruits: ['Banana (vgn)', 'Banana (vgn)'] }, 'lunch');
    expect(r.ok).toBe(true);
  });

  it('allows two different fruits with no dessert', () => {
    const r = validateOrderItems({ ...BASE, fruits: ['Apple (vgn)', 'Banana (vgn)'] }, 'lunch');
    expect(r.ok).toBe(true);
  });

  it('rejects three fruits even if all same (no dessert)', () => {
    const r = validateOrderItems({ ...BASE, fruits: ['Apple (vgn)', 'Apple (vgn)', 'Apple (vgn)'] }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 2 fruits/i);
  });

  it('allows one duplicate fruit with dessert', () => {
    const r = validateOrderItems({ ...BASE, dessert: DESSERTS[0], fruits: ['Banana (vgn)'] }, 'lunch');
    expect(r.ok).toBe(true);
  });

  it('rejects two fruits (including duplicate) with dessert', () => {
    const r = validateOrderItems({ ...BASE, dessert: DESSERTS[0], fruits: ['Banana (vgn)', 'Banana (vgn)'] }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 1 fruit/i);
  });

  it('rejects invalid fruit even in multiset', () => {
    const r = validateOrderItems({ ...BASE, fruits: ['Apple (vgn)', 'Mango'] }, 'lunch');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/invalid fruit/i);
  });
});
