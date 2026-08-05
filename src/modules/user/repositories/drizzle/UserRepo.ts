import { eq } from "drizzle-orm";
import { db } from "../../../../shared/database/conn";
import { users } from "../../../../shared/database/schema";
import { User } from "../../domain/User";
import { IUserRepo } from "../IUserRepo";
import { BadRequestError, NotFoundError } from "../../../../shared/core/errors";
import { isUniqueViolation } from "../../../../shared/database/errors";
import { UserMap } from "../../mappers/UserMap";

export type UpdateUserParams = {
  id: string;
  name?: string;
  email?: string;
  updated_at?: Date;
};

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

  async create(user: User): Promise<void> {
    try {
      await db.insert(users).values({
        ...user,
        email: user.email.value,
      });
    } catch (e: unknown) {
      // The caller checks exists() first, but that check and this insert are
      // not atomic: concurrent signups both pass it and one hits the
      // constraint. Only the database can settle the race.
      if (isUniqueViolation(e, "user_email_unique")) {
        throw new BadRequestError("User already exists with this email");
      }
      throw e;
    }
  }

  async update(user: UpdateUserParams): Promise<User> {
    const result = await db
      .update(users)
      .set({
        name: user.name,
        email: user.email,
        updated_at: user.updated_at ?? new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    if (!result[0]) throw new NotFoundError("User not found.");

    return UserMap.toDomain(result[0]);
  }
}
