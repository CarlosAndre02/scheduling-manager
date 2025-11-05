import express from "express";

import { CreateMeetingController } from "../useCases/createMeeting/CreateMeetingController";
import { CreateMeetingUseCase } from "../useCases/createMeeting/CreateMeetingUseCase";
import { GetMeetingByIdController } from "../useCases/getMeetingById/GetMeetingByIdController";
import { GetMeetingByIdUseCase } from "../useCases/getMeetingById/GetMeetingByIdUseCase";
import { MeetingRepo } from "../repositories/drizzle/MeetingRepo";
import { UserRepo } from "../../user/repositories/drizzle/UserRepo";

export const meetingRouter = express.Router();

const meetingRepository = new MeetingRepo();
const userRepository = new UserRepo();
const createMeetingUseCase = new CreateMeetingUseCase(
  meetingRepository,
  userRepository,
);
const createMeetingController = new CreateMeetingController(
  createMeetingUseCase,
);

const getMeetingByIdUseCase = new GetMeetingByIdUseCase(meetingRepository);
const getMeetingByIdController = new GetMeetingByIdController(
  getMeetingByIdUseCase,
);

meetingRouter.post("/meetings", (req, res) =>
  createMeetingController.execute(req, res),
);
meetingRouter.get("/meetings/:id", (req, res) =>
  getMeetingByIdController.execute(req, res),
);
