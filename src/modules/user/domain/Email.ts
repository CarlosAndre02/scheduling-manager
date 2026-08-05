import { BadRequestError } from "../../../shared/core/errors";

/**
 * Owns every rule about an email address: what a valid one looks like and what
 * form it is stored in. Normalising and validating used to live in different
 * layers, which let `Carlos@Example.COM` and `carlos@example.com` become two
 * accounts depending on which path created them.
 */
export class Email {
  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static create(raw: string): Email {
    const normalized = Email.normalize(raw);

    if (!Email.isValid(normalized)) {
      throw new BadRequestError("Email is not valid");
    }

    return new Email(normalized);
  }

  public static normalize(raw: string): string {
    return raw.trim().toLowerCase();
  }

  public static isValid(email: string) {
    const re =
      // eslint-disable-next-line
      /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }

  // Keeps the address a plain string once it crosses the API boundary.
  public toJSON(): string {
    return this.value;
  }

  public toString(): string {
    return this.value;
  }
}
