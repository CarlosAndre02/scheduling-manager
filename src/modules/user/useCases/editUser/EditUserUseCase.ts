import { BadRequestError, NotFoundError } from "../../../../shared/core/errors";
import { UseCase } from "../../../../shared/core/UseCase";
import { User } from "../../domain/User";
import { IUserRepo } from "../../repositories/IUserRepo";
import { EditUserDTO } from "./EditUserDTO";

export class EditUserUseCase implements UseCase<EditUserDTO, User> {
  private userRepo: IUserRepo;

  constructor(userRepo: IUserRepo) {
    this.userRepo = userRepo;
  }

  async execute(request: EditUserDTO): Promise<User> {
    const userAlreadyExists = await this.userRepo.getUserByUserId(
      request.userId,
    );
    if (!userAlreadyExists) throw new NotFoundError("User not found");

    if (request.name && !User.isValidName(request.name)) {
      throw new BadRequestError("Name should be between 3 and 50 characters");
    }

    if (request.email && !User.isValidEmail(request.email)) {
      throw new BadRequestError("Email is not valid");
    }

    const user = await this.userRepo.update({
      id: request.userId,
      name: request.name,
      email: request.email,
    });
    return user;
  }
}
