import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { requireUuid } from "../../../../shared/core/RequestInput";
import { GetSchedulingByIdUseCase } from "./GetSchedulingByIdUseCase";

export class GetSchedulingByIdController implements BaseController {
  private useCase: GetSchedulingByIdUseCase;

  constructor(useCase: GetSchedulingByIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const schedulingId = requireUuid(req.params.id, "id");

    const scheduling = await this.useCase.execute({ schedulingId });

    return res.status(200).json({ data: scheduling });
  }
}
