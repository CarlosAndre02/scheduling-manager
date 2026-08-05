import { BadRequestError } from "./errors";
import { TextUtils } from "../utils/TextUtils";

type GuardArgumentCollection = {
  argument: unknown;
  argumentName: string;
}[];

type TextArgumentCollection = {
  argument: string;
  argumentName: string;
}[];

export class Guard {
  public static againstNullOrUndefined(
    argument: unknown,
    argumentName: string,
  ): boolean {
    if (argument === null || argument === undefined) {
      throw new BadRequestError(`${argumentName} is null or undefined`);
    } else {
      return true;
    }
  }

  public static againstNullOrUndefinedBulk(
    args: GuardArgumentCollection,
  ): boolean {
    for (const arg of args) {
      this.againstNullOrUndefined(arg.argument, arg.argumentName);
    }

    return true;
  }

  public static againstHtml(argument: string, argumentName: string): boolean {
    if (TextUtils.containsHtmlTag(argument)) {
      throw new BadRequestError(`${argumentName} must not contain HTML`);
    }

    return true;
  }

  public static againstHtmlBulk(args: TextArgumentCollection): boolean {
    for (const arg of args) {
      this.againstHtml(arg.argument, arg.argumentName);
    }

    return true;
  }
}
