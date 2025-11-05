import { Request, Response } from "express";

import { CreateMeetingUseCase } from "./CreateMeetingUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateMeetingDTO } from "./CreateMeetingDTO";
import { TextUtils } from "../../../../shared/utils/TextUtils";

export class CreateMeetingController implements BaseController {
  private useCase: CreateMeetingUseCase;

  constructor(useCase: CreateMeetingUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const meetingDTO = req.body as CreateMeetingDTO;

    const sanitizedMeetingDTO: CreateMeetingDTO = {
      name: TextUtils.sanitize(meetingDTO.name).trim(),
      description: TextUtils.sanitize(meetingDTO.description).trim(),
      start_datetime: meetingDTO.start_datetime.trim(),
      end_datetime: meetingDTO.end_datetime.trim(),
      meetingDurationInMinutes: meetingDTO.meetingDurationInMinutes,
      conferenceLink: meetingDTO.conferenceLink.trim(),
      userId: meetingDTO.userId,
    };

    const response = await this.useCase.execute(sanitizedMeetingDTO);

    if (!response.success)
      return res
        .status(400)
        .json({ success: false, message: "Unable to create meeting" });

    return res.status(201).json({ success: true, message: response.message });
  }
}
