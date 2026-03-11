// ════════════════════════════════════════════════════════════════════
// Ortega Dining Menu — single source of truth for items + validation
// ════════════════════════════════════════════════════════════════════

export const LUNCH_ENTREES = [
  'Creamy Pesto Pasta with Chicken',
  'Bacon Breakfast Burrito',
  'Breakfast Burrito (v)',
  'Spaghetti with Pork Marinara & Cheese',
  'Chicken Caesar Salad',
  'Greek Pasta Salad (v)',
  'Roast Beef & Cheddar Sub',
  'Steak Burrito',
  'Classic Burger',
  'Veggie Burger (v)',
  'Roasted Vegetable Pasta (vgn)',
  'Pressed Bean & Cheese Burrito (v)',
  'Chipotle BBQ Chicken & Potatoes',
  'Teriyaki Tofu Stir Fry (vgn)',
] as const;

export const DINNER_EXTRA_ENTREES = [
  'Tikka Masala with Chicken',
] as const;

export const SIDES = [
  'Chipotle Chowder Corn (v)',
  'House Salad (vgn)',
  'Sauteed Zucchini & Yellow Squash (vgn)',
  'Roasted Potato Medley with Kale (vgn)',
  'Hummus with Celery & Carrots (vgn)',
  'Fries (vgn)',
  'Potato Chip (vgn)',
] as const;

export const DESSERTS = [
  'Banana Chocolate Chip Cookie (vgn)',
] as const;

export const FRUITS = [
  'Apple (vgn)',
  'Navel Orange (vgn)',
  'Banana (vgn)',
] as const;

export const BEVERAGES = ['Water'] as const;

export const CONDIMENTS = [
  'Balsamic Vinaigrette (vgn)',
  'Ranch Dressing (v)',
  'Mayonnaise (v)',
  'Ketchup (vgn)',
  'Mustard Packet (vgn)',
] as const;

// ── Hours ────────────────────────────────────────────────────────────
export type MealPeriod = 'lunch' | 'dinner' | 'closed';

/** Returns the current meal period in America/Los_Angeles time. */
export function getMealPeriod(date: Date = new Date()): MealPeriod {
  const la   = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day  = la.getDay();   // 0=Sun 6=Sat
  const hour = la.getHours();
  if (day === 0 || day === 6) return 'closed';
  if (hour >= 10 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 20) return 'dinner';
  return 'closed';
}

/** Returns null when open, or a human-readable closed reason. */
export function getClosedReason(date: Date = new Date()): string | null {
  const la   = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const day  = la.getDay();
  const hour = la.getHours();
  if (day === 0 || day === 6) return 'Ortega is closed on weekends.';
  if (hour < 10)  return 'Ortega opens at 10:00 AM PT.';
  if (hour >= 20) return 'Ortega closes at 8:00 PM PT.';
  return null;
}

export function isOrtegaOpen(date?: Date): boolean {
  return getClosedReason(date) === null;
}

export function getAvailableEntrees(period: MealPeriod): readonly string[] {
  if (period === 'closed') return [];
  const base: string[] = [...LUNCH_ENTREES];
  if (period === 'dinner') base.push(...DINNER_EXTRA_ENTREES);
  return base;
}

// ── Order items structure ─────────────────────────────────────────
export interface OrderItems {
  entree:     string;
  side:       string | null;
  dessert:    string | null;
  fruits:     string[];
  beverage:   string | null;
  condiments: string[];
  notes:      string | null;
}

export interface ValidationResult {
  ok:     boolean;
  errors: string[];
}

/** Pure validation — usable in both server routes and unit tests. */
export function validateOrderItems(items: OrderItems, period: MealPeriod): ValidationResult {
  const errors: string[] = [];
  const available = getAvailableEntrees(period);

  // Entree
  if (!items.entree) {
    errors.push('An entree is required.');
  } else if (!available.includes(items.entree)) {
    errors.push(`"${items.entree}" is not on the ${period} menu.`);
  }

  // Side (max 1)
  if (items.side && !(SIDES as readonly string[]).includes(items.side)) {
    errors.push(`Invalid side: "${items.side}".`);
  }

  // Dessert (max 1)
  if (items.dessert && !(DESSERTS as readonly string[]).includes(items.dessert)) {
    errors.push(`Invalid dessert: "${items.dessert}".`);
  }

  // Fruit (max 1 with dessert, max 2 without; duplicates allowed)
  const maxFruits = items.dessert ? 1 : 2;
  if (items.fruits.length > maxFruits) {
    errors.push(items.dessert
      ? `Max 1 fruit when a dessert is selected (got ${items.fruits.length}).`
      : `Max 2 fruits (got ${items.fruits.length}).`);
  }
  for (const f of items.fruits) {
    if (!(FRUITS as readonly string[]).includes(f)) errors.push(`Invalid fruit: "${f}".`);
  }

  // Beverage
  if (items.beverage && !(BEVERAGES as readonly string[]).includes(items.beverage)) {
    errors.push(`Invalid beverage: "${items.beverage}".`);
  }

  // Condiments
  for (const c of items.condiments) {
    if (!(CONDIMENTS as readonly string[]).includes(c)) errors.push(`Invalid condiment: "${c}".`);
  }

  return { ok: errors.length === 0, errors };
}
