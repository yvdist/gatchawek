import * as Sentry from "@sentry/cloudflare";

/**
 * Forward a caught error to Sentry (Better Stack). Call from every
 * `catch` that swallows errors into user-facing messages — the Sentry
 * Hono middleware only captures *unhandled* exceptions, not caught ones.
 * No-op when Sentry is not initialized (e.g. DSN secret missing).
 */
export function reportError(prefix: string, error: unknown): void {
  try {
    if (typeof error === "object" && error !== null) {
      Sentry.captureException(error, { extra: { prefix } });
    } else {
      Sentry.captureMessage(`${prefix}: ${String(error)}`, "error");
    }
  } catch {
    // Never let error reporting break the user-facing reply path.
  }
}
