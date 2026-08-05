import { BadRequestError } from "../../../../shared/core/errors";
import { UseCase } from "../../../../shared/core/UseCase";
import { User } from "../../domain/User";
import { Email } from "../../domain/Email";
import { IUserRepo } from "../../repositories/IUserRepo";
import { EditUserDTO } from "./EditUserDTO";

export class EditUserUseCase implements UseCase<EditUserDTO, User> {
  private userRepo: IUserRepo;

  constructor(userRepo: IUserRepo) {
    this.userRepo = userRepo;
  }

  async execute(request: EditUserDTO): Promise<User> {
    // Throws NotFoundError when the user does not exist.
    await this.userRepo.getUserByUserId(request.userId);

    if (request.name && !User.isValidName(request.name)) {
      throw new BadRequestError("Name should be between 3 and 50 characters");
    }

    const user = await this.userRepo.update({
      id: request.userId,
      name: request.name,
      email: request.email ? Email.create(request.email).value : undefined,
    });
    return user;
  }
}
