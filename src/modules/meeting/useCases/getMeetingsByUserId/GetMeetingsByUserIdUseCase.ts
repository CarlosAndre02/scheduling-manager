import { UseCase } from "../../../../shared/core/UseCase";
import { Meeting } from "../../domain/Meeting";
import { IMeetingRepo } from "../../repositories/IMeetingRepo";
import { GetMeetingsByUserIdDTO } from "./GetMeetingsByUserIdDTO";
import { UserRepo } from "../../../user/repositories/drizzle/UserRepo";

export class GetMeetingsByUserIdUseCase
  implements UseCase<GetMeetingsByUserIdDTO, Meeting[]>
{
  private meetingRepo: IMeetingRepo;
  private userRepo: UserRepo;

  constructor(meetingRepo: IMeetingRepo, userRepo: UserRepo) {
    this.meetingRepo = meetingRepo;
    this.userRepo = userRepo;
  }

  async execute(request: GetMeetingsByUserIdDTO): Promise<Meeting[]> {
    await this.userRepo.getUserByUserId(request.userId);

    const meetings = await this.meetingRepo.getMeetingsByUserId(request.userId);
    return meetings;
  }
}
