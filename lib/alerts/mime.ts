// Pure: builds the RFC 5322 message the Gmail API expects (base64url of the whole thing).

/** RFC 2047 encoded-word, so subjects and names with emoji or accents survive. */
export function encodeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** Header values must never contain a line break (that is how header injection works). */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function buildMime(opts: { from: string; fromName?: string; to: string; subject: string; text: string }): string {
  const from = opts.fromName ? `${encodeHeader(oneLine(opts.fromName))} <${oneLine(opts.from)}>` : oneLine(opts.from);
  const body = Buffer.from(opts.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return [
    `From: ${from}`,
    `To: ${oneLine(opts.to)}`,
    `Subject: ${encodeHeader(oneLine(opts.subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

export function toBase64Url(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

/** Seed employees use @placeholder.invalid until a supervisor enters their real address. */
export function isPlaceholderEmail(email: string): boolean {
  return /\.invalid$/i.test(email.trim());
}
