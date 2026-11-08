import { describe, expect, it } from "vitest";
import { isValidTimeZone } from "./time";

describe("isValidTimeZone", () => {
  it("accepts IANA zones", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Asia/Colombo")).toBe(true);
  });
  it("rejects junk", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
