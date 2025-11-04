import { User } from "../domain/User";
import { UpdateUserParams } from "./drizzle/UserRepo";

export interface IUserRepo {
  exists(userEmail: string): Promise<boolean>;
  getUserByUserId(userId: string): Promise<User>;
  create(user: User): Promise<{ success: boolean }>;
  update(user: UpdateUserParams): Promise<User>;
}
