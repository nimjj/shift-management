import { describe, expect, it } from "vitest";
import { emailDomain, isAllowedEmail, safeRedirectPath } from "./auth-rules";

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Nimithra@Adept-Tech.US")).toBe("adept-tech.us");
  });
  it("returns empty string when there is no @", () => {
    expect(emailDomain("nimithra")).toBe("");
  });
  it("uses the last @", () => {
    expect(emailDomain("a@b@adept-tech.us")).toBe("adept-tech.us");
  });
});

describe("isAllowedEmail", () => {
  const domains = ["adept-tech.us"];
  it("accepts an allowed domain regardless of case", () => {
    expect(isAllowedEmail("x@ADEPT-TECH.us", domains)).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isAllowedEmail("x@gmail.com", domains)).toBe(false);
  });
  it("rejects look-alike and subdomains", () => {
    expect(isAllowedEmail("x@adept-tech.us.evil.com", domains)).toBe(false);
    expect(isAllowedEmail("x@mail.adept-tech.us", domains)).toBe(false);
    expect(isAllowedEmail("x@notadept-tech.us", domains)).toBe(false);
  });
  it("rejects when no domains are configured or email is malformed", () => {
    expect(isAllowedEmail("x@adept-tech.us", [])).toBe(false);
    expect(isAllowedEmail("nope", domains)).toBe(false);
  });
  it("supports several allowed domains", () => {
    expect(isAllowedEmail("x@b.com", ["a.com", "b.com"])).toBe(true);
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/checkin/abc?x=1")).toBe("/checkin/abc?x=1");
  });
  it("falls back for empty values", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });
  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
  });
});
