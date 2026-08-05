import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { requireUuid } from "../../../../shared/core/RequestInput";
import { GetUserByIdUseCase } from "./GetUserByIdUseCase";

export class GetUserByIdController implements BaseController {
  private useCase: GetUserByIdUseCase;

  constructor(useCase: GetUserByIdUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const userId = requireUuid(req.params.id, "id");

    const user = await this.useCase.execute({ userId });

    return res.status(200).json({ data: user });
  }
}
