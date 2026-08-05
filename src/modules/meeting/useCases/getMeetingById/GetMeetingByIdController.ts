import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { requireUuid } from "../../../../shared/core/RequestInput";
import { GetMeetingByIdUseCase } from "./GetMeetingByIdUseCase";

export class GetMeetingByIdController implements BaseController {
  private useCase: GetMeetingByIdUseCase;

  constructor(useCase: GetMeetingByIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const meetingId = requireUuid(req.params.id, "id");

    const meeting = await this.useCase.execute({ meetingId });

    return res.status(200).json({ data: meeting });
  }
}
