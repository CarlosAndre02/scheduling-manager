import validator from "validator";

// Loopback, private and link-local ranges. A conference link pointing at one of
// these is either a mistake or an attempt to aim the reader at internal
// infrastructure — 169.254.169.254 is the cloud instance metadata endpoint.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

const PRIVATE_IPV6_PATTERNS = [/^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab]/i];

export class TextUtils {
  public static isValidUTCDate(date: string): boolean {
    // Require full ISO-8601 with time component and UTC suffix 'Z'
    // Examples accepted: 2025-11-04T10:00:00Z, 2025-11-04T10:00:00.000Z
    const isoUtcWithTimeRegex =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
    return isoUtcWithTimeRegex.test(date);
  }

  public static isValidUuid(value: string): boolean {
    return validator.isUUID(value);
  }

  /**
   * Emails are stored lowercased so `Carlos@Example.COM` and
   * `carlos@example.com` cannot become two accounts for the same person.
   */
  public static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Detects the start of an HTML tag, not the `<` character itself: `Ana <3
   * Bob` and `5 < 10` are ordinary text and must survive untouched, while
   * `<b>`, `</div>` and `<!--` are rejected.
   *
   * This API answers JSON, which a browser does not execute, so escaping
   * belongs to whoever renders the value. Storing markup would only make the
   * consumer's job harder, so it is refused at the door rather than mangled.
   */
  public static containsHtmlTag(text: string): boolean {
    return /<[a-zA-Z/!?]/.test(text);
  }

  public static validateWebURL(url: string): boolean {
    const isWebUrl = validator.isURL(url, {
      require_protocol: true,
      protocols: ["http", "https"],
    });
    if (!isWebUrl) return false;

    return !TextUtils.hasPrivateHost(url);
  }

  private static hasPrivateHost(url: string): boolean {
    let hostname: string;

    try {
      hostname = new URL(url).hostname;
    } catch {
      return true;
    }

    // URL keeps IPv6 literals wrapped in brackets.
    const host = hostname.replace(/^\[|]$/g, "");

    return [...PRIVATE_HOST_PATTERNS, ...PRIVATE_IPV6_PATTERNS].some(
      (pattern) => pattern.test(host),
    );
  }
}
