import { User } from "../domain/User";

export class UserMap {
  public static toDomain(raw: any): User {
    const user = new User(raw);
    return user;
  }
}
