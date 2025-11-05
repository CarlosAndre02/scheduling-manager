import validator from "validator";
import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";

const window = new JSDOM("").window;
const domPurify = DOMPurify(window);

export class TextUtils {
  public static sanitize(unsafeText: string): string {
    return domPurify.sanitize(unsafeText);
  }

  public static isValidUTCDate(date: string): boolean {
    // Require full ISO-8601 with time component and UTC suffix 'Z'
    // Examples accepted: 2025-11-04T10:00:00Z, 2025-11-04T10:00:00.000Z
    const isoUtcWithTimeRegex =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
    return isoUtcWithTimeRegex.test(date);
  }

  public static validateWebURL(url: string): boolean {
    return validator.isURL(url);
  }
}
