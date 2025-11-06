import { UseCase } from "../../../../shared/core/UseCase";
import { Scheduling } from "../../domain/Scheduling";
import { ISchedulingRepo } from "../../repositories/ISchedulingRepo";
import { GetSchedulingsByHostIdDTO } from "./GetSchedulingsByHostIdDTO";
import { UserRepo } from "../../../user/repositories/drizzle/UserRepo";

export class GetSchedulingsByHostIdUseCase
  implements UseCase<GetSchedulingsByHostIdDTO, Scheduling[]>
{
  private schedulingRepo: ISchedulingRepo;
  private userRepo: UserRepo;

  constructor(schedulingRepo: ISchedulingRepo, userRepo: UserRepo) {
    this.schedulingRepo = schedulingRepo;
    this.userRepo = userRepo;
  }

  async execute(request: GetSchedulingsByHostIdDTO): Promise<Scheduling[]> {
    await this.userRepo.getUserByUserId(request.hostId);

    const schedulings = await this.schedulingRepo.getSchedulingsByHostId(
      request.hostId,
    );
    return schedulings;
  }
}
