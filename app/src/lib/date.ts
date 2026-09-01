/** Local calendar day as YYYY-MM-DD. Deliberately local, not UTC: a streak is
 *  about the user's day, and UTC would break it for anyone east of London. */
export function today(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local calendar day an ISO timestamp fell on. Storing UTC and comparing it
 *  to a local date silently breaks for anyone whose evening is the next day in
 *  Greenwich — finish a session at 01:00 in Berlin and it lands on "yesterday". */
export function localDateOf(iso: string): string {
  return today(new Date(iso));
}

/** Whole days between two YYYY-MM-DD dates. Uses UTC midnights internally so
 *  DST transitions can't turn a 23-hour day into 0. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
