// Pure: maps Postgres/PostgREST errors to messages that are safe to show a supervisor.
// No I/O and no server-only import, so it is unit tested.

/** Throw from server code to return a friendly error instead of a generic failure. */
export class ActionError extends Error {}

export type PgErrorLike = { code?: string | null; message: string; details?: string | null };

export function isPgErrorLike(e: unknown): e is PgErrorLike {
  return typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string";
}

/**
 * Returns an ActionError for errors we expect users to hit, or null for anything unexpected.
 *  - P0001: our own `raise exception ... using errcode = 'P0001'` validation messages (shown as-is)
 *  - 42501: not a supervisor / RLS denied
 *  - 23505: unique violation
 */
export function mapPostgresError(err: PgErrorLike): ActionError | null {
  switch (err.code) {
    case "P0001":
      return new ActionError(err.message);
    case "42501":
      return new ActionError("You don't have permission to do that.");
    case "23505": {
      const text = `${err.message} ${err.details ?? ""}`;
      if (/employees_email_key/.test(text)) return new ActionError("An employee with that email already exists.");
      if (/shift_templates_code_key/.test(text)) return new ActionError("A block with that code already exists.");
      return new ActionError("That already exists.");
    }
    default:
      return null;
  }
}
