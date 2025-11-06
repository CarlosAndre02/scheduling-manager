import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { GetSchedulingsByHostIdUseCase } from "./GetSchedulingsByHostIdUseCase";

export class GetSchedulingsByHostIdController implements BaseController {
  private useCase: GetSchedulingsByHostIdUseCase;

  constructor(useCase: GetSchedulingsByHostIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const hostId = req.params.hostId;

    const schedulings = await this.useCase.execute({ hostId });

    return res.status(200).json({ data: schedulings });
  }
}
