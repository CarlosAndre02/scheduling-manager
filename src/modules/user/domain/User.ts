import { v4 as uuidV4 } from "uuid";
import { Guard } from "../../../shared/core/Guard";
import { BadRequestError } from "../../../shared/core/errors";

export type UserProps = {
  id?: string;
  name: string;
  email: string;
  updated_at?: Date | null;
  created_at?: Date;
};

export class User {
  public readonly id: string;
  public readonly name: string;
  public readonly email: string;
  public readonly updated_at?: Date | null;
  public readonly created_at?: Date;

  public constructor(user: UserProps) {
    user.id = user.id ?? uuidV4();

    this.validate(user);

    this.id = user.id;
    this.name = user.name;
    this.email = user.email;
    this.updated_at = user.updated_at;
    this.created_at = user.created_at;
  }

  private validate(user: UserProps) {
    Guard.againstNullOrUndefinedBulk([
      { argument: user.name, argumentName: "name" },
      { argument: user.email, argumentName: "email" },
    ]);

    if (!User.isValidName(user.name))
      throw new BadRequestError("Name should be between 3 and 50 characters");

    if (!User.isValidEmail(user.email))
      throw new BadRequestError("Email is not valid");
  }

  public static isValidName(name: string) {
    return name.length >= 3 && name.length <= 50;
  }

  public static isValidEmail(email: string) {
    const re =
      // eslint-disable-next-line
      /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
  }
}
