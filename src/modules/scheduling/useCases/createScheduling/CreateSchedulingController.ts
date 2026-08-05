import { Request, Response } from "express";

import { CreateSchedulingUseCase } from "./CreateSchedulingUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateSchedulingDTO } from "./CreateSchedulingDTO";
import {
  requireString,
  requireUuid,
} from "../../../../shared/core/RequestInput";

export class CreateSchedulingController implements BaseController {
  private useCase: CreateSchedulingUseCase;

  constructor(useCase: CreateSchedulingUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const body = req.body ?? {};

    const dto: CreateSchedulingDTO = {
      schedulingDatetime: requireString(
        body.schedulingDatetime,
        "schedulingDatetime",
      ),
      name: requireString(body.name, "name"),
      purpose: requireString(body.purpose, "purpose"),
      hostId: requireUuid(body.hostId, "hostId"),
      guestId: requireUuid(body.guestId, "guestId"),
      meetingId: requireUuid(body.meetingId, "meetingId"),
    };

    const response = await this.useCase.execute(dto);

    if (!response.success)
      return res
        .status(400)
        .json({ success: false, message: "Unable to create scheduling" });

    return res.status(201).json({ success: true, message: response.message });
  }
}
