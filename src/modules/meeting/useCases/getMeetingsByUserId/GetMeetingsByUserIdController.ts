import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { GetMeetingsByUserIdUseCase } from "./GetMeetingsByUserIdUseCase";

export class GetMeetingsByUserIdController implements BaseController {
  private useCase: GetMeetingsByUserIdUseCase;

  constructor(useCase: GetMeetingsByUserIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const userId = req.params.userId;

    const meetings = await this.useCase.execute({ userId });

    return res.status(200).json({ data: meetings });
  }
}
