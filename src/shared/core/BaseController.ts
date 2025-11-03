import { Request, Response } from "express";

export interface BaseController {
  execute(request: Request, response: Response): Promise<Response> | Response;
}
