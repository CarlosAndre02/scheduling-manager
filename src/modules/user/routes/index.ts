import express from "express";
import { CreateUserController } from "../useCases/createUser/CreateUserController";
import { CreateUserUseCase } from "../useCases/createUser/CreateUserUseCase";
import { GetUserByIdUseCase } from "../useCases/getUserById/GetUserByIdUseCase";
import { GetUserByIdController } from "../useCases/getUserById/GetUserByIdController";
import { EditUserUseCase } from "../useCases/editUser/EditUserUseCase";
import { EditUserController } from "../useCases/editUser/EditUserController";
import { UserRepo } from "../repositories/drizzle/UserRepo";

export const userRouter = express.Router();

const userRepository = new UserRepo();
const createUserUseCase = new CreateUserUseCase(userRepository);
const createUserController = new CreateUserController(createUserUseCase);

const getUserByIdUseCase = new GetUserByIdUseCase(userRepository);
const getUserByIdController = new GetUserByIdController(getUserByIdUseCase);

const editUserUseCase = new EditUserUseCase(userRepository);
const editUserController = new EditUserController(editUserUseCase);

userRouter.post("/users", (req, res) => createUserController.execute(req, res));
userRouter.get("/users/:id", (req, res) =>
  getUserByIdController.execute(req, res),
);
userRouter.put("/users/:id", (req, res) =>
  editUserController.execute(req, res),
);
