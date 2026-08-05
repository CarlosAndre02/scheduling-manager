import { Request, Response } from "express";

import { CreateMeetingUseCase } from "./CreateMeetingUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateMeetingDTO } from "./CreateMeetingDTO";
import {
  requireInteger,
  requireString,
  requireUuid,
} from "../../../../shared/core/RequestInput";

export class CreateMeetingController implements BaseController {
  private useCase: CreateMeetingUseCase;

  constructor(useCase: CreateMeetingUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const body = req.body ?? {};

    const meetingDTO: CreateMeetingDTO = {
      name: requireString(body.name, "name"),
      description: requireString(body.description, "description"),
      start_datetime: requireString(body.start_datetime, "start_datetime"),
      end_datetime: requireString(body.end_datetime, "end_datetime"),
      meetingDurationInMinutes: requireInteger(
        body.meetingDurationInMinutes,
        "meetingDurationInMinutes",
      ),
      conferenceLink: requireString(body.conferenceLink, "conferenceLink"),
      userId: requireUuid(body.userId, "userId"),
    };

    const response = await this.useCase.execute(meetingDTO);

    return res.status(201).json({ success: true, message: response.message });
  }
}
