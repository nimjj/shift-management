import { describe, expect, it } from "vitest";
import { createEmployeeSchema, employeeFormToObject, updateEmployeeSchema } from "./schema";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("employeeFormToObject", () => {
  it("maps the checkbox 'on' to true and absence to false", () => {
    expect(employeeFormToObject(form({ active: "on" })).active).toBe(true);
    expect(employeeFormToObject(form({})).active).toBe(false);
  });
  it("defaults role to agent and text fields to empty strings", () => {
    const o = employeeFormToObject(form({}));
    expect(o).toMatchObject({ role: "agent", full_name: "", email: "", display_tz: "" });
    expect(o.id).toBeUndefined();
  });
});

describe("createEmployeeSchema", () => {
  const valid = { full_name: "  Pooja  ", email: "  Pooja@Adept-Tech.US ", role: "agent", display_tz: "", active: true };

  it("trims the name and lowercases and trims the email", () => {
    const r = createEmployeeSchema.parse(valid);
    expect(r.full_name).toBe("Pooja");
    expect(r.email).toBe("pooja@adept-tech.us");
  });

  it("turns a blank display time zone into null", () => {
    expect(createEmployeeSchema.parse(valid).display_tz).toBeNull();
  });

  it("accepts a real IANA time zone and rejects an unknown one", () => {
    expect(createEmployeeSchema.parse({ ...valid, display_tz: "Asia/Colombo" }).display_tz).toBe("Asia/Colombo");
    const bad = createEmployeeSchema.safeParse({ ...valid, display_tz: "Mars/Olympus" });
    expect(bad.success).toBe(false);
  });

  it("rejects empty names, bad emails and unknown roles", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, full_name: "   " }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, role: "admin" }).success).toBe(false);
  });

  it("does not check the email domain (the database function does, from org_settings)", () => {
    expect(createEmployeeSchema.safeParse({ ...valid, email: "x@gmail.com" }).success).toBe(true);
  });
});

describe("updateEmployeeSchema", () => {
  const base = { full_name: "A", email: "a@adept-tech.us", role: "supervisor", display_tz: "", active: true };

  it("requires a uuid id", () => {
    expect(updateEmployeeSchema.safeParse({ ...base, id: "nope" }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ ...base, id: "2f8d3a5e-6a7b-4c1d-9e0f-1a2b3c4d5e6f" }).success).toBe(true);
  });
});
