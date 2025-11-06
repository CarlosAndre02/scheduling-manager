import express from "express";

import { CreateSchedulingController } from "../useCases/createScheduling/CreateSchedulingController";
import { CreateSchedulingUseCase } from "../useCases/createScheduling/CreateSchedulingUseCase";
import { GetSchedulingByIdController } from "../useCases/getSchedulingById/GetSchedulingByIdController";
import { GetSchedulingByIdUseCase } from "../useCases/getSchedulingById/GetSchedulingByIdUseCase";
import { SchedulingRepo } from "../repositories/drizzle/SchedulingRepo";
import { UserRepo } from "../../user/repositories/drizzle/UserRepo";
import { MeetingRepo } from "../../meeting/repositories/drizzle/MeetingRepo";

export const schedulingRouter = express.Router();

const schedulingRepository = new SchedulingRepo();
const userRepository = new UserRepo();
const meetingRepository = new MeetingRepo();
const createSchedulingUseCase = new CreateSchedulingUseCase(
  schedulingRepository,
  userRepository,
  meetingRepository,
);
const createSchedulingController = new CreateSchedulingController(
  createSchedulingUseCase,
);

const getSchedulingByIdUseCase = new GetSchedulingByIdUseCase(
  schedulingRepository,
);
const getSchedulingByIdController = new GetSchedulingByIdController(
  getSchedulingByIdUseCase,
);

schedulingRouter.post("/schedulings", (req, res) =>
  createSchedulingController.execute(req, res),
);
schedulingRouter.get("/schedulings/:id", (req, res) =>
  getSchedulingByIdController.execute(req, res),
);
