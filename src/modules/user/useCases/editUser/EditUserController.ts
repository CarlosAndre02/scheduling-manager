import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { EditUserUseCase } from "./EditUserUseCase";
import { EditUserDTO } from "./EditUserDTO";
import {
  optionalString,
  requireUuid,
} from "../../../../shared/core/RequestInput";
import { TextUtils } from "../../../../shared/utils/TextUtils";

export class EditUserController implements BaseController {
  private useCase: EditUserUseCase;

  constructor(useCase: EditUserUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const body = req.body ?? {};
    const email = optionalString(body.email, "email");

    const editUserDTO: EditUserDTO = {
      userId: requireUuid(req.params.id, "id"),
      name: optionalString(body.name, "name"),
      email: email ? TextUtils.normalizeEmail(email) : undefined,
    };

    const user = await this.useCase.execute(editUserDTO);

    return res.status(200).json({ data: user });
  }
}
