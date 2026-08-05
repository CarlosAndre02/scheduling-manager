import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { requireUuid } from "../../../../shared/core/RequestInput";
import { parsePagination } from "../../../../shared/core/Pagination";
import { GetMeetingsByUserIdUseCase } from "./GetMeetingsByUserIdUseCase";

export class GetMeetingsByUserIdController implements BaseController {
  private useCase: GetMeetingsByUserIdUseCase;

  constructor(useCase: GetMeetingsByUserIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const userId = requireUuid(req.params.userId, "userId");
    const pagination = parsePagination(req.query);

    const meetings = await this.useCase.execute({ userId, pagination });

    return res.status(200).json({
      data: meetings,
      pagination: { ...pagination, count: meetings.length },
    });
  }
}
