import { User } from "../domain/User";

export interface IUserRepo {
  exists(userEmail: string): Promise<boolean>;
  getUserByUserId(userId: string): Promise<User>;
  create(user: User): Promise<{ success: boolean }>;
}
