import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { userRouter } from "./modules/user/routes";
import { DefaultError } from "./shared/core/errors";

const app = express();
const PORT = process.env.SERVER_PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello World!" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

app.use(userRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof DefaultError) {
    console.log(`\n[${err.name}]: An Application error occurred`);
    console.error(err.message);
    return res.status(err.code).json({
      message: err.message,
    });
  }

  console.log("\nInternal server error");
  console.error(err);
  return res.status(500).json({
    status: "error",
    message: `Internal server error - ${err.message}`,
  });
});

app.listen(PORT as number, () => {
  console.log(`\nServer is running on port ${PORT}`);
  console.log(`Hello World endpoint: http://localhost:${PORT}/`);
});

export default app;
