import { UseCase } from "../../../../shared/core/UseCase";
import { Scheduling } from "../../domain/Scheduling";
import { ISchedulingRepo } from "../../repositories/ISchedulingRepo";
import { GetSchedulingByIdDTO } from "./GetSchedulingByIdDTO";

export class GetSchedulingByIdUseCase
  implements UseCase<GetSchedulingByIdDTO, Scheduling>
{
  private schedulingRepo: ISchedulingRepo;

  constructor(schedulingRepo: ISchedulingRepo) {
    this.schedulingRepo = schedulingRepo;
  }

  async execute(request: GetSchedulingByIdDTO): Promise<Scheduling> {
    const scheduling = await this.schedulingRepo.getSchedulingBySchedulingId(
      request.schedulingId,
    );
    return scheduling;
  }
}
