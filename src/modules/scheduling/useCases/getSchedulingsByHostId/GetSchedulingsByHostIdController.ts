import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { parsePagination } from "../../../../shared/core/Pagination";
import { GetSchedulingsByHostIdUseCase } from "./GetSchedulingsByHostIdUseCase";

export class GetSchedulingsByHostIdController implements BaseController {
  private useCase: GetSchedulingsByHostIdUseCase;

  constructor(useCase: GetSchedulingsByHostIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const hostId = req.params.hostId;
    const pagination = parsePagination(req.query);

    const schedulings = await this.useCase.execute({ hostId, pagination });

    return res.status(200).json({
      data: schedulings,
      pagination: { ...pagination, count: schedulings.length },
    });
  }
}
