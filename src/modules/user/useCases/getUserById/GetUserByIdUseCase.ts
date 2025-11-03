import { UseCase } from "../../../../shared/core/UseCase";
import { User } from "../../domain/User";
import { IUserRepo } from "../../repositories/IUserRepo";
import { GetUserByIdDTO } from "./GetUserByIdDTO";

export class GetUserByIdUseCase implements UseCase<GetUserByIdDTO, User> {
  private userRepo: IUserRepo;

  constructor(userRepo: IUserRepo) {
    this.userRepo = userRepo;
  }

  async execute(request: GetUserByIdDTO): Promise<User> {
    const user = await this.userRepo.getUserByUserId(request.userId);
    return user;
  }
}
