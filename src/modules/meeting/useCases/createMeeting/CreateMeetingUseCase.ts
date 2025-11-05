import { BadRequestError, DefaultError } from "../../../../shared/core/errors";
import { UseCase } from "../../../../shared/core/UseCase";
import { MeetingMap } from "../../mappers/MeetingMap";
import { IMeetingRepo } from "../../repositories/IMeetingRepo";
import { CreateMeetingDTO } from "./CreateMeetingDTO";
import { UserRepo } from "../../../user/repositories/drizzle/UserRepo";
import { TextUtils } from "../../../../shared/utils/TextUtils";

type CreateMeetingResponse = {
  success: boolean;
  message: string;
};

export class CreateMeetingUseCase
  implements UseCase<CreateMeetingDTO, CreateMeetingResponse>
{
  private meetingRepo: IMeetingRepo;
  private userRepo: UserRepo;

  constructor(meetingRepo: IMeetingRepo, userRepo: UserRepo) {
    this.meetingRepo = meetingRepo;
    this.userRepo = userRepo;
  }

  async execute(request: CreateMeetingDTO): Promise<CreateMeetingResponse> {
    await this.userRepo.getUserByUserId(request.userId);

    const startIsUTC = TextUtils.isValidUTCDate(request.start_datetime);
    const endIsUTC = TextUtils.isValidUTCDate(request.end_datetime);
    if (!startIsUTC || !endIsUTC)
      throw new BadRequestError("Datetimes must be in UTC");

    const meeting = MeetingMap.toDomain({
      ...request,
      start_datetime: new Date(request.start_datetime),
      end_datetime: new Date(request.end_datetime),
      isActive: true,
    });

    try {
      const result = await this.meetingRepo.create(meeting);
      if (!result.success)
        throw new BadRequestError("Unable to create meeting");

      return {
        success: true,
        message: "Meeting created successfully",
      };
    } catch (e: unknown) {
      if (e instanceof DefaultError) throw e;

      console.error(e);
      throw new Error("Unable to create meeting");
    }
  }
}
