// Re-exports from menu.ts for backward compatibility
export { getMealPeriod, getClosedReason, isOrtegaOpen } from './menu';
export type { MealPeriod } from './menu';

// Alias used by board/page.tsx and api/listings/route.ts
// (same as getClosedReason — returns null when open, string when closed)
export { getClosedReason as ortegaClosedReason } from './menu';
