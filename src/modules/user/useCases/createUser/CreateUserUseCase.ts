import { BadRequestError, DefaultError } from "../../../../shared/core/errors";
import { UseCase } from "../../../../shared/core/UseCase";
import { UserMap } from "../../mappers/UserMap";
import { IUserRepo } from "../../repositories/IUserRepo";
import { CreateUserDTO } from "./CreateUserDTO";

type CreateUserResponse = {
  success: boolean;
  message: string;
};

export class CreateUserUseCase
  implements UseCase<CreateUserDTO, CreateUserResponse>
{
  private userRepo: IUserRepo;

  constructor(userRepo: IUserRepo) {
    this.userRepo = userRepo;
  }

  async execute(request: CreateUserDTO): Promise<CreateUserResponse> {
    const user = UserMap.toDomain(request);

    try {
      const userAlreadyExists = await this.userRepo.exists(user.email);
      if (userAlreadyExists)
        throw new BadRequestError("User already exists with this email");

      const result = await this.userRepo.create(user);
      if (!result.success) throw new BadRequestError("Unable to create user");

      return {
        success: true,
        message: "User created successfully",
      };
    } catch (e: unknown) {
      if (e instanceof DefaultError) throw e;

      console.error(e);
      throw new Error("Unable to create user");
    }
  }
}
