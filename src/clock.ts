/** Injectable time source and ET (America/New_York) calendar helpers. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string | Date): Clock {
  const at = typeof iso === "string" ? new Date(iso) : iso;
  return { now: () => new Date(at) };
}

const ET = "America/New_York";

/** ET calendar date ("YYYY-MM-DD") and time ("HH:MM"). */
export function etParts(at: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ET,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function nyDate(at: Date): string {
  return etParts(at).date;
}

export function marketToday(clock: Clock = systemClock): string {
  return nyDate(clock.now());
}

/** Pure calendar math on date-only strings (UTC is fine for date-only values). */
export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
