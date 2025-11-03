import { eq } from "drizzle-orm";
import { db } from "../../../../shared/database/conn";
import { users } from "../../../../shared/database/schema";
import { User } from "../../domain/User";
import { IUserRepo } from "../IUserRepo";
import { NotFoundError } from "../../../../shared/core/errors";
import { UserMap } from "../../mappers/UserMap";

export class UserRepo implements IUserRepo {
  async exists(userEmail: string): Promise<boolean> {
    const userResponse = await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.email, userEmail))
      .limit(1);
    return !!userResponse[0];
  }

  async getUserByUserId(userId: string): Promise<User> {
    const userResponse = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!userResponse[0]) throw new NotFoundError("User not found.");

    return UserMap.toDomain(userResponse[0]);
  }

  async create(user: User): Promise<{ success: boolean }> {
    const result = await db
      .insert(users)
      .values({
        ...user,
      })
      .returning();

    if (!result[0]) {
      return {
        success: false,
      };
    }

    return { success: true };
  }
}
