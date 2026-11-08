import { z } from "zod";
import { isValidTimeZone } from "@/lib/time";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** "Adept-Tech.us, mail.example.com" -> ["adept-tech.us", "mail.example.com"] (lowercased, deduped). */
export function parseDomains(input: string): string[] {
  const parts = input
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(parts)];
}

const zone = (label: string) =>
  z
    .string()
    .trim()
    .refine(isValidTimeZone, `${label}: unknown time zone (use e.g. America/Chicago)`);

export const generalSchema = z.object({
  org_name: z.string().trim().min(1, "Organisation name is required").max(100),
  client_tz: zone("Client time zone"),
  default_display_tz: zone("Display time zone"),
  week_start: z.coerce.number().int().min(0).max(6),
  allowed_domains: z
    .string()
    .transform(parseDomains)
    .pipe(
      z
        .array(z.string().regex(DOMAIN_RE, "Domains must look like example.com"))
        .min(1, "At least one allowed email domain is required"),
    ),
});

export function generalFormToObject(fd: FormData) {
  return {
    org_name: fd.get("org_name")?.toString() ?? "",
    client_tz: fd.get("client_tz")?.toString() ?? "",
    default_display_tz: fd.get("default_display_tz")?.toString() ?? "",
    week_start: fd.get("week_start")?.toString() ?? "1",
    allowed_domains: fd.get("allowed_domains")?.toString() ?? "",
  };
}
