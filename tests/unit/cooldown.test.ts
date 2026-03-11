import { describe, it, expect } from 'vitest';
import { SELLER_COOLDOWN_MS, BUYER_COOLDOWN_MS, LOCK_DURATION_MS } from '../../src/lib/status';

describe('cooldown constants', () => {
  it('SELLER_COOLDOWN_MS is 90 minutes', () => {
    expect(SELLER_COOLDOWN_MS).toBe(90 * 60 * 1000);
  });

  it('BUYER_COOLDOWN_MS is 90 minutes', () => {
    expect(BUYER_COOLDOWN_MS).toBe(90 * 60 * 1000);
  });

  it('LOCK_DURATION_MS is 10 minutes', () => {
    expect(LOCK_DURATION_MS).toBe(10 * 60 * 1000);
  });
});

describe('cooldown calculation logic', () => {
  it('computes remaining seller cooldown correctly', () => {
    const completedAt  = new Date(Date.now() - 30 * 60_000); // 30 min ago
    const remainingMs  = completedAt.getTime() + SELLER_COOLDOWN_MS - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    expect(remainingMin).toBeGreaterThan(55);
    expect(remainingMin).toBeLessThanOrEqual(60);
  });

  it('cooldown expired if completedAt > 90 min ago', () => {
    const completedAt = new Date(Date.now() - 91 * 60_000); // 91 min ago
    const remainingMs = completedAt.getTime() + SELLER_COOLDOWN_MS - Date.now();
    expect(remainingMs).toBeLessThanOrEqual(0);
  });

  it('lock duration expires after 10 min', () => {
    const lockStart  = Date.now();
    const lockExpiry = lockStart + LOCK_DURATION_MS;
    expect(lockExpiry - lockStart).toBe(10 * 60 * 1000);
  });
});
