import { UseCase } from "../../../../shared/core/UseCase";
import { Meeting } from "../../domain/Meeting";
import { IMeetingRepo } from "../../repositories/IMeetingRepo";
import { GetMeetingByIdDTO } from "./GetMeetingByIdDTO";

export class GetMeetingByIdUseCase
  implements UseCase<GetMeetingByIdDTO, Meeting>
{
  private meetingRepo: IMeetingRepo;

  constructor(meetingRepo: IMeetingRepo) {
    this.meetingRepo = meetingRepo;
  }

  async execute(request: GetMeetingByIdDTO): Promise<Meeting> {
    const meeting = await this.meetingRepo.getMeetingByMeetingId(
      request.meetingId,
    );
    return meeting;
  }
}
