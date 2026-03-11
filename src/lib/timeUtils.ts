/**
 * Returns an ISO-8601 string for midnight at the start of the current calendar
 * day in America/Los_Angeles (Pacific Time), correctly handling DST transitions.
 *
 * Strategy: sample noon UTC on the current PT date, measure what PT hour that
 * maps to, and back-calculate the UTC offset (noon is safely mid-day, away
 * from the 2am DST boundary).
 */
export function pacificDayStart(): string {
  const now = new Date();

  // Step 1: current date string in PT, e.g. "2026-03-10"
  const todayPT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
  }).format(now);

  // Step 2: noon UTC on that date — always safe to use for offset detection
  const noonUTC = new Date(`${todayPT}T12:00:00.000Z`);

  // Step 3: what hour is it in PT when UTC is noon?
  //   PST (UTC-8): 12 - 8 = 04  →  ptNoonHour = 4
  //   PDT (UTC-7): 12 - 7 = 05  →  ptNoonHour = 5
  const ptNoonStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour:     '2-digit',
    hour12:   false,
  }).format(noonUTC);
  const ptNoonHour    = parseInt(ptNoonStr, 10);
  const ptOffsetHours = ptNoonHour - 12; // -8 (PST) or -7 (PDT)

  // Step 4: midnight PT = UTC midnight + |offset| hours
  //   PST: midnightUTCHour = 8  → "YYYY-MM-DDT08:00:00.000Z" = 00:00 PST
  //   PDT: midnightUTCHour = 7  → "YYYY-MM-DDT07:00:00.000Z" = 00:00 PDT
  const midnightUTCHour = -ptOffsetHours;
  return `${todayPT}T${String(midnightUTCHour).padStart(2, '0')}:00:00.000Z`;
}

/**
 * Returns the ISO string for the START of the NEXT Pacific calendar day
 * (i.e. when today's daily limits reset).
 */
export function nextPacificDayStart(): string {
  // Add 24 h to today's midnight — Intl handles any leftover DST drift
  return new Date(new Date(pacificDayStart()).getTime() + 24 * 60 * 60 * 1000).toISOString();
}
