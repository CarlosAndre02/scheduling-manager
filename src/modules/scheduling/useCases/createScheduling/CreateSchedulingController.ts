import { Request, Response } from "express";

import { CreateSchedulingUseCase } from "./CreateSchedulingUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateSchedulingDTO } from "./CreateSchedulingDTO";
import { TextUtils } from "../../../../shared/utils/TextUtils";

export class CreateSchedulingController implements BaseController {
  private useCase: CreateSchedulingUseCase;

  constructor(useCase: CreateSchedulingUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const dto = req.body as CreateSchedulingDTO;

    const sanitizedDTO: CreateSchedulingDTO = {
      schedulingDatetime: dto.schedulingDatetime.trim(),
      name: TextUtils.sanitize(dto.name).trim(),
      purpose: TextUtils.sanitize(dto.purpose).trim(),
      hostId: dto.hostId.trim(),
      guestId: dto.guestId.trim(),
      meetingId: dto.meetingId.trim(),
    };

    const response = await this.useCase.execute(sanitizedDTO);

    if (!response.success)
      return res
        .status(400)
        .json({ success: false, message: "Unable to create scheduling" });

    return res.status(201).json({ success: true, message: response.message });
  }
}
