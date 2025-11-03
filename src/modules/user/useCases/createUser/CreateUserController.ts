import { Request, Response } from "express";

import { CreateUserUseCase } from "./CreateUserUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateUserDTO } from "./CreateUserDTO";
import { TextUtils } from "../../../../shared/utils/TextUtils";

export class CreateUserController implements BaseController {
  private useCase: CreateUserUseCase;

  constructor(useCase: CreateUserUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const userDTO = req.body as CreateUserDTO;

    const sanitizedUserDTO: CreateUserDTO = {
      name: TextUtils.sanitize(userDTO.name).trim(),
      email: TextUtils.sanitize(userDTO.email).trim(),
    };

    const response = await this.useCase.execute(sanitizedUserDTO);

    if (!response.success)
      return res
        .status(400)
        .json({ success: false, message: "Unable to create user" });

    return res.status(201).json({ success: true, message: response.message });
  }
}
