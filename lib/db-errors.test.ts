import { describe, expect, it } from "vitest";
import { ActionError, isPgErrorLike, mapPostgresError } from "./db-errors";

describe("mapPostgresError", () => {
  it("shows our own validation messages (P0001) as-is", () => {
    const e = mapPostgresError({ code: "P0001", message: "You can't deactivate or demote yourself." });
    expect(e).toBeInstanceOf(ActionError);
    expect(e?.message).toBe("You can't deactivate or demote yourself.");
  });

  it("maps permission errors (42501) to a generic message, not the raw one", () => {
    const e = mapPostgresError({ code: "42501", message: "new row violates row-level security policy" });
    expect(e?.message).toBe("You don't have permission to do that.");
  });

  it("maps a duplicate employee email", () => {
    const e = mapPostgresError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "employees_email_key"',
    });
    expect(e?.message).toBe("An employee with that email already exists.");
  });

  it("uses the details field to recognise the email constraint too", () => {
    const e = mapPostgresError({
      code: "23505",
      message: "duplicate key",
      details: 'Key (email)=(a@b.c) conflicts. constraint "employees_email_key"',
    });
    expect(e?.message).toBe("An employee with that email already exists.");
  });

  it("gives a generic message for other unique violations", () => {
    expect(mapPostgresError({ code: "23505", message: "x_other_key" })?.message).toBe("That already exists.");
  });

  it("returns null for unexpected errors so they are logged, not shown", () => {
    expect(mapPostgresError({ code: "XX000", message: "internal" })).toBeNull();
    expect(mapPostgresError({ message: "no code" })).toBeNull();
  });
});

describe("isPgErrorLike", () => {
  it("recognises objects with a string message", () => {
    expect(isPgErrorLike({ message: "x" })).toBe(true);
    expect(isPgErrorLike(new Error("x"))).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isPgErrorLike(null)).toBe(false);
    expect(isPgErrorLike("x")).toBe(false);
    expect(isPgErrorLike({ message: 1 })).toBe(false);
  });
});
