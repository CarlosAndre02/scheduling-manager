import { User, UserProps } from "../domain/User";

export class UserMap {
  public static toDomain(raw: UserProps): User {
    const user = new User(raw);
    return user;
  }
}
