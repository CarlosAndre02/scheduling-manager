import { BadRequestError } from "./errors";

type GuardArgumentCollection = {
  argument: unknown;
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
}
