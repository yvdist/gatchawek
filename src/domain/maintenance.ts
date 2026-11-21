/**
 * Scheduled database outage window. `MAINTENANCE_UNTIL` is an ISO 8601
 * instant: while the worker clock is before it, every Discord interaction is
 * answered without touching the database. Self-expiring, so the bot comes
 * back on its own — no follow-up deploy at 07:00 WIB.
 */

/** End of the window in epoch ms, or null when unset, unparseable, or past. */
export function maintenanceUntil(
  raw: string | undefined,
  nowMs: number,
): number | null {
  if (raw === undefined || raw === "") return null;
  const until = Date.parse(raw);
  if (!Number.isFinite(until) || until <= nowMs) return null;
  return until;
}

/** `HH:MM WIB` (UTC+7, no DST) for the end of the window. */
export function wibClock(epochMs: number): string {
  const wib = new Date(epochMs + 7 * 3_600_000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} WIB`;
}

/** One message for slash commands and buttons during the window. */
export function maintenanceMessage(untilMs: number): string {
  return (
    `🛠️ Bot maintenance sampai ${wibClock(untilMs)} — semua command (termasuk /gacha) ` +
    "mati sementara karena database lagi pulih. Kartu, koleksi, dan level kamu aman; " +
    "tidak ada yang hilang. Coba lagi setelah jam itu."
  );
}
