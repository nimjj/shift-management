import { describe, expect, it } from "vitest";
import { config } from "../../proxy";

// Next compiles `matcher` with path-to-regexp. For this pattern ("/" + one regex group) that is
// equivalent to anchoring the string as a plain regex.
const toRegExp = (matcher: string) => new RegExp(`^${matcher}$`);
const runsProxy = (matcher: string, path: string) => toRegExp(matcher).test(path);

const matcher = config.matcher[0];

// The bug that was fixed: a single backslash inside a JS string collapses to "." (any character).
const BROKEN = "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)";

describe("proxy matcher", () => {
  it("is a single string pattern with a literal-dot extension exclusion", () => {
    expect(config.matcher).toHaveLength(1);
    expect(matcher).toContain("\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$");
    expect(matcher).toContain("favicon\\.ico");
  });

  it("runs on app pages and API routes", () => {
    for (const path of ["/", "/login", "/settings/employees", "/checkin/abc123", "/auth/callback", "/api/health"]) {
      expect(runsProxy(matcher, path), path).toBe(true);
    }
  });

  it("skips Next internals and static image files", () => {
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/logo.svg", "/img/a/b.png"]) {
      expect(runsProxy(matcher, path), path).toBe(false);
    }
  });

  it("does NOT skip paths that merely end in the letters of an extension (no dot)", () => {
    for (const path of ["/mysvg", "/settings/employeespng", "/faviconXico"]) {
      expect(runsProxy(matcher, path), path).toBe(true);
    }
  });

  it("regression: the single-backslash version wrongly skipped those paths", () => {
    expect(runsProxy(BROKEN, "/mysvg")).toBe(false);
    expect(runsProxy(BROKEN, "/settings/employeespng")).toBe(false);
  });
});
