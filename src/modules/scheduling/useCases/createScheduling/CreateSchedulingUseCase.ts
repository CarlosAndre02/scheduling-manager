import {
  BadRequestError,
  DefaultError,
  NotFoundError,
} from "../../../../shared/core/errors";
import { UseCase } from "../../../../shared/core/UseCase";
import { TextUtils } from "../../../../shared/utils/TextUtils";
import { SchedulingMap } from "../../mappers/SchedulingMap";
import { ISchedulingRepo } from "../../repositories/ISchedulingRepo";
import { CreateSchedulingDTO } from "./CreateSchedulingDTO";
import { UserRepo } from "../../../user/repositories/drizzle/UserRepo";
import { MeetingRepo } from "../../../meeting/repositories/drizzle/MeetingRepo";

type CreateSchedulingResponse = {
  success: boolean;
  message: string;
};

export class CreateSchedulingUseCase
  implements UseCase<CreateSchedulingDTO, CreateSchedulingResponse>
{
  private schedulingRepo: ISchedulingRepo;
  private userRepo: UserRepo;
  private meetingRepo: MeetingRepo;

  constructor(
    schedulingRepo: ISchedulingRepo,
    userRepo: UserRepo,
    meetingRepo: MeetingRepo,
  ) {
    this.schedulingRepo = schedulingRepo;
    this.userRepo = userRepo;
    this.meetingRepo = meetingRepo;
  }

  async execute(
    request: CreateSchedulingDTO,
  ): Promise<CreateSchedulingResponse> {
    const [host, guest, meeting] = await Promise.all([
      this.userRepo.getUserByUserId(request.hostId),
      this.userRepo.getUserByUserId(request.guestId),
      this.meetingRepo.getMeetingByMeetingId(request.meetingId),
    ]);

    if (!host || !guest) throw new NotFoundError("User not found.");
    if (!meeting) throw new NotFoundError("Meeting not found.");
    if (!meeting.isActive) throw new BadRequestError("Meeting is not active");

    if (request.hostId === request.guestId)
      throw new BadRequestError("hostId and guestId cannot be the same");

    if (!TextUtils.isValidUTCDate(request.schedulingDatetime))
      throw new BadRequestError(
        "schedulingDatetime must be in UTC (ISO string ending with 'Z' and time)",
      );

    const schedulingDate = new Date(request.schedulingDatetime);

    if (
      schedulingDate < meeting.start_datetime ||
      schedulingDate > meeting.end_datetime
    )
      throw new BadRequestError(
        "schedulingDatetime must be between meeting available datetimes",
      );

    const scheduling = SchedulingMap.toDomain({
      ...request,
      schedulingDatetime: schedulingDate,
      isActive: true,
    });

    try {
      const result = await this.schedulingRepo.create(scheduling);
      if (!result.success)
        throw new BadRequestError("Unable to create scheduling");

      return { success: true, message: "Scheduling created successfully" };
    } catch (e: unknown) {
      if (e instanceof DefaultError) throw e;
      console.error(e);
      throw new Error("Unable to create scheduling");
    }
  }
}
