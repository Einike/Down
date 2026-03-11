// ════════════════════════════════════════════════════════════════════
// STATUS — single source of truth. Must match DB CHECK constraints.
// ════════════════════════════════════════════════════════════════════

export const ListingStatus = {
  OPEN:        'OPEN',
  LOCKED:      'LOCKED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
  CANCELLED:   'CANCELLED',
  EXPIRED:     'EXPIRED',
} as const;
export type ListingStatusType = typeof ListingStatus[keyof typeof ListingStatus];

export const OrderStatus = {
  LOCKED:          'LOCKED',           // buyer claimed, 10-min lock to customize
  BUYER_SUBMITTED: 'BUYER_SUBMITTED',  // buyer submitted meal choices
  SELLER_ACCEPTED: 'SELLER_ACCEPTED',  // seller accepted, must upload QR
  QR_UPLOADED:     'QR_UPLOADED',      // QR uploaded, buyer can view
  COMPLETED:       'COMPLETED',        // buyer confirmed pickup
  CANCELLED:       'CANCELLED',        // cancelled by either party
} as const;
export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];

// Sets for guards
export const ACTIVE_LISTING_STATUSES: ListingStatusType[] = [
  ListingStatus.OPEN, ListingStatus.LOCKED, ListingStatus.IN_PROGRESS,
];
export const ACTIVE_ORDER_STATUSES: OrderStatusType[] = [
  OrderStatus.LOCKED, OrderStatus.BUYER_SUBMITTED,
  OrderStatus.SELLER_ACCEPTED, OrderStatus.QR_UPLOADED,
];

// Valid status transitions
export const LISTING_TRANSITIONS: Partial<Record<ListingStatusType, ListingStatusType[]>> = {
  OPEN:        [ListingStatus.LOCKED, ListingStatus.CANCELLED, ListingStatus.EXPIRED],
  LOCKED:      [ListingStatus.OPEN, ListingStatus.IN_PROGRESS, ListingStatus.CANCELLED],
  IN_PROGRESS: [ListingStatus.COMPLETED, ListingStatus.CANCELLED],
};
export const ORDER_TRANSITIONS: Partial<Record<OrderStatusType, OrderStatusType[]>> = {
  LOCKED:          [OrderStatus.BUYER_SUBMITTED, OrderStatus.CANCELLED],
  BUYER_SUBMITTED: [OrderStatus.SELLER_ACCEPTED, OrderStatus.CANCELLED],
  SELLER_ACCEPTED: [OrderStatus.QR_UPLOADED, OrderStatus.CANCELLED],
  QR_UPLOADED:     [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
};

// Cooldowns (milliseconds)
export const SELLER_COOLDOWN_MS = 90 * 60_000;  // 90 min after listing ends
export const BUYER_COOLDOWN_MS  = 90 * 60_000;  // 90 min after completing purchase
export const CLAIM_COOLDOWN_MS  = 60_000;        // 1 min between buyer claims (in-memory rate limit)
export const LOCK_DURATION_MS   = 10 * 60_000;   // 10 min lock for buyer to customize

// Abuse prevention limits
export const DAILY_BUYER_CLAIM_LIMIT = 3; // max claims per buyer per Pacific calendar day
