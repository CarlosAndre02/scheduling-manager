import { Request, Response } from "express";

import { BaseController } from "../../../../shared/core/BaseController";
import { EditUserUseCase } from "./EditUserUseCase";
import { EditUserDTO } from "./EditUserDTO";
import { TextUtils } from "../../../../shared/utils/TextUtils";

export class EditUserController implements BaseController {
  private useCase: EditUserUseCase;

  constructor(useCase: EditUserUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const userId = req.params.id;
    const editUserDTO = req.body as EditUserDTO;

    const sanitizedUserDTO: EditUserDTO = {
      userId: userId,
      name: editUserDTO.name
        ? TextUtils.sanitize(editUserDTO.name).trim()
        : undefined,
      email: editUserDTO.email
        ? TextUtils.sanitize(editUserDTO.email).trim()
        : undefined,
    };

    const user = await this.useCase.execute(sanitizedUserDTO);

    return res.status(200).json({ data: user });
  }
}
