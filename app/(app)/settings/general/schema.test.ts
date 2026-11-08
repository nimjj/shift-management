import { describe, expect, it } from "vitest";
import { generalFormToObject, generalSchema, parseDomains } from "./schema";

const valid = {
  org_name: "  Adept Technologies ",
  client_tz: "America/Chicago",
  default_display_tz: "Asia/Colombo",
  week_start: "1",
  allowed_domains: "Adept-Tech.us",
};

describe("parseDomains", () => {
  it("splits on commas, spaces, semicolons and newlines; lowercases; dedupes", () => {
    expect(parseDomains("Adept-Tech.us, mail.example.com;adept-tech.us\nOTHER.org")).toEqual([
      "adept-tech.us",
      "mail.example.com",
      "other.org",
    ]);
  });
  it("returns an empty list for blank input", () => {
    expect(parseDomains("  ,  ; ")).toEqual([]);
  });
});

describe("generalSchema", () => {
  it("parses a valid form, trimming and normalising", () => {
    const r = generalSchema.parse(valid);
    expect(r.org_name).toBe("Adept Technologies");
    expect(r.week_start).toBe(1);
    expect(r.allowed_domains).toEqual(["adept-tech.us"]);
  });

  it("accepts Sunday (0) and Saturday (6) as week start, rejects others", () => {
    expect(generalSchema.safeParse({ ...valid, week_start: "0" }).success).toBe(true);
    expect(generalSchema.safeParse({ ...valid, week_start: "6" }).success).toBe(true);
    expect(generalSchema.safeParse({ ...valid, week_start: "7" }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, week_start: "-1" }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, week_start: "1.5" }).success).toBe(false);
  });

  it("rejects unknown time zones in either field", () => {
    expect(generalSchema.safeParse({ ...valid, client_tz: "Mars/Olympus" }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, default_display_tz: "" }).success).toBe(false);
  });

  it("requires at least one domain and rejects malformed ones", () => {
    expect(generalSchema.safeParse({ ...valid, allowed_domains: "  " }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, allowed_domains: "not a domain" }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, allowed_domains: "localhost" }).success).toBe(false);
    expect(generalSchema.safeParse({ ...valid, allowed_domains: "-bad.com" }).success).toBe(false);
  });

  it("accepts several domains", () => {
    const r = generalSchema.parse({ ...valid, allowed_domains: "adept-tech.us, sub.example.co.uk" });
    expect(r.allowed_domains).toEqual(["adept-tech.us", "sub.example.co.uk"]);
  });

  it("rejects an empty organisation name", () => {
    expect(generalSchema.safeParse({ ...valid, org_name: "   " }).success).toBe(false);
  });
});

describe("generalFormToObject", () => {
  it("reads all fields from FormData with safe defaults", () => {
    const fd = new FormData();
    fd.set("org_name", "X");
    expect(generalFormToObject(fd)).toMatchObject({ org_name: "X", client_tz: "", week_start: "1", allowed_domains: "" });
  });
});
