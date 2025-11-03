import express from "express";
import { CreateUserController } from "../useCases/createUser/CreateUserController";
import { CreateUserUseCase } from "../useCases/createUser/CreateUserUseCase";
import { UserRepo } from "../repositories/drizzle/UserRepo";

export const userRouter = express.Router();

const userRepository = new UserRepo();
const createUserUseCase = new CreateUserUseCase(userRepository);
const createUserController = new CreateUserController(createUserUseCase);

userRouter.post("/users", (req, res) => createUserController.execute(req, res));
