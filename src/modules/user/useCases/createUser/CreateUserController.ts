import { Request, Response } from "express";

import { CreateUserUseCase } from "./CreateUserUseCase";
import { BaseController } from "../../../../shared/core/BaseController";
import { CreateUserDTO } from "./CreateUserDTO";
import { requireString } from "../../../../shared/core/RequestInput";

export class CreateUserController implements BaseController {
  private useCase: CreateUserUseCase;

  constructor(useCase: CreateUserUseCase) {
    this.useCase = useCase;
  }

  async execute(req: Request, res: Response): Promise<Response> {
    const body = req.body ?? {};

    const userDTO: CreateUserDTO = {
      name: requireString(body.name, "name"),
      email: requireString(body.email, "email"),
    };

    const response = await this.useCase.execute(userDTO);

    return res.status(201).json({ success: true, message: response.message });
  }
}
