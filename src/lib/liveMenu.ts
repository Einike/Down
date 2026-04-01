// ════════════════════════════════════════════════════════════════════
// Live menu fetcher — fetches today's Ortega menu from UCSB Dining,
// caches for 1 hour, and falls back to hardcoded menu.ts on failure.
// ════════════════════════════════════════════════════════════════════

import { LUNCH_ENTREES, DINNER_EXTRA_ENTREES } from './menu';

const DINING_URL = 'https://apps.dining.ucsb.edu/menu/day?dc=ortega';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface LiveMenuCache {
  entrees:     string[];   // lunch entrees
  dinnerExtras: string[];  // dinner-only specials
  source:      'live' | 'fallback';
  fetchedAt:   number;     // Date.now()
}

// Module-level cache — persists across requests within the same serverless instance.
let _cache: LiveMenuCache | null = null;

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseEntreesFromHtml(html: string): { entrees: string[]; dinnerExtras: string[] } {
  const entrees: string[] = [];
  const dinnerExtras: string[] = [];
  let section = '';

  // Match <dt> (section headers) and <dd> (menu items)
  const re = /<(dt|dd)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag  = m[1].toLowerCase();
    const text = decodeHtml(m[2].replace(/<[^>]+>/g, '').trim());
    if (!text) continue;

    if (tag === 'dt') {
      section = text.toLowerCase();
    } else if (tag === 'dd') {
      const isEntree = ['entrees', 'sandwiches', 'burgers', 'burritos',
                        'salads', 'pasta', 'wraps', 'pizza', 'breakfast'].includes(section);
      const isDinner = ['entree specials', 'dinner specials', 'specials'].includes(section);
      if (isEntree)  entrees.push(text);
      if (isDinner)  dinnerExtras.push(text);
    }
  }

  return { entrees, dinnerExtras };
}

/** Returns today's Ortega entrees (live or cached). Falls back to hardcoded menu. */
export async function getLiveEntrees(): Promise<LiveMenuCache> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache;

  try {
    const res = await fetch(DINING_URL, {
      signal: AbortSignal.timeout(5_000),
      cache:  'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const { entrees, dinnerExtras } = parseEntreesFromHtml(html);

    if (entrees.length > 0) {
      _cache = { entrees, dinnerExtras, source: 'live', fetchedAt: Date.now() };
      return _cache;
    }
    throw new Error('No entrees parsed from dining page');
  } catch (e) {
    console.warn('[liveMenu] fetch/parse failed, using hardcoded fallback:', e);
    // Retry in 5 min instead of a full hour — transient failures clear faster
    const retryAt = Date.now() - CACHE_TTL_MS + 5 * 60_000;
    const fallback: LiveMenuCache = {
      entrees:      [...LUNCH_ENTREES],
      dinnerExtras: [...DINNER_EXTRA_ENTREES],
      source:       'fallback',
      fetchedAt:    retryAt,
    };
    if (!_cache) _cache = fallback;
    return _cache;
  }
}
