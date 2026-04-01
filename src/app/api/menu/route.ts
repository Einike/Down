import { NextResponse } from 'next/server';
import { getLiveEntrees } from '@/lib/liveMenu';
import { getMealPeriod, SIDES, DESSERTS, FRUITS, BEVERAGES, CONDIMENTS } from '@/lib/menu';

// GET /api/menu — returns today's Ortega menu (live-fetched, hourly cache)
export async function GET() {
  const period = getMealPeriod();
  const live   = await getLiveEntrees();

  const entrees = period === 'dinner'
    ? [...live.entrees, ...live.dinnerExtras]
    : live.entrees;

  return NextResponse.json({
    period,
    entrees,
    sides:      [...SIDES],
    desserts:   [...DESSERTS],
    fruits:     [...FRUITS],
    beverages:  [...BEVERAGES],
    condiments: [...CONDIMENTS],
    source:     live.source,
    fetchedAt:  new Date(live.fetchedAt).toISOString(),
  }, {
    // Never CDN-cache — period changes throughout the day
    headers: { 'Cache-Control': 'no-store' },
  });
}
