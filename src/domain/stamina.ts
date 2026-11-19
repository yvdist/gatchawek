export interface StaminaState {
  stamina: number;
  anchorAt: number;
}

export function normalize(
  s: StaminaState,
  max: number,
  interval: number,
  now: number,
): StaminaState {
  if (s.stamina >= max) return { stamina: max, anchorAt: now };
  const gained = Math.max(0, Math.floor((now - s.anchorAt) / interval));
  const stamina = Math.min(max, s.stamina + gained);
  if (stamina >= max) return { stamina: max, anchorAt: now };
  return { stamina, anchorAt: s.anchorAt + gained * interval };
}

export function consume(
  s: StaminaState,
  max: number,
  interval: number,
  now: number,
): StaminaState | null {
  const n = normalize(s, max, interval, now);
  if (n.stamina < 1) return null;
  return { stamina: n.stamina - 1, anchorAt: n.anchorAt };
}

/** Tick timestamp for display; uses the normalized state. Null when full. */
export const nextTickAt = (
  n: StaminaState,
  max: number,
  interval: number,
): number | null => (n.stamina >= max ? null : n.anchorAt + interval);

/** Full-recharge timestamp for display. Null when already full. */
export const fullAt = (
  n: StaminaState,
  max: number,
  interval: number,
): number | null =>
  n.stamina >= max ? null : n.anchorAt + (max - n.stamina) * interval;

export const resetReadyAt = (
  lastResetAt: number | null,
  cooldown: number,
): number => (lastResetAt === null ? 0 : lastResetAt + cooldown);

export type ResetCheck =
  | { ok: true }
  | { ok: false; reason: "full" | "cooldown"; readyAt: number };

export function canReset(
  normalized: StaminaState,
  max: number,
  lastResetAt: number | null,
  cooldown: number,
  now: number,
): ResetCheck {
  if (normalized.stamina >= max) {
    return { ok: false, reason: "full", readyAt: now };
  }
  const readyAt = resetReadyAt(lastResetAt, cooldown);
  if (now < readyAt) return { ok: false, reason: "cooldown", readyAt };
  return { ok: true };
}
