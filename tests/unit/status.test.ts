import { describe, it, expect } from 'vitest';
import {
  ListingStatus,
  OrderStatus,
  ACTIVE_LISTING_STATUSES,
  ACTIVE_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  LISTING_TRANSITIONS,
} from '../../src/lib/status';

describe('status constants', () => {
  it('ListingStatus values are strings', () => {
    for (const v of Object.values(ListingStatus)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('OrderStatus values are strings', () => {
    for (const v of Object.values(OrderStatus)) {
      expect(typeof v).toBe('string');
    }
  });

  it('ACTIVE_LISTING_STATUSES contains OPEN and LOCKED', () => {
    expect(ACTIVE_LISTING_STATUSES).toContain('OPEN');
    expect(ACTIVE_LISTING_STATUSES).toContain('LOCKED');
  });

  it('ACTIVE_ORDER_STATUSES does not contain COMPLETED or CANCELLED', () => {
    expect(ACTIVE_ORDER_STATUSES).not.toContain('COMPLETED');
    expect(ACTIVE_ORDER_STATUSES).not.toContain('CANCELLED');
  });

  it('valid order transitions', () => {
    expect(ORDER_TRANSITIONS.LOCKED).toContain('BUYER_SUBMITTED');
    expect(ORDER_TRANSITIONS.BUYER_SUBMITTED).toContain('SELLER_ACCEPTED');
    expect(ORDER_TRANSITIONS.SELLER_ACCEPTED).toContain('QR_UPLOADED');
    expect(ORDER_TRANSITIONS.QR_UPLOADED).toContain('COMPLETED');
  });

  it('terminal statuses have no further transitions', () => {
    expect(ORDER_TRANSITIONS.COMPLETED).toBeUndefined();
    expect(ORDER_TRANSITIONS.CANCELLED).toBeUndefined();
    expect(LISTING_TRANSITIONS.COMPLETED).toBeUndefined();
  });
});
