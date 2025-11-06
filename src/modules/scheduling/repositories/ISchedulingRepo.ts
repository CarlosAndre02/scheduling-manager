import { Scheduling } from "../domain/Scheduling";

export interface ISchedulingRepo {
  create(scheduling: Scheduling): Promise<{ success: boolean }>;
}
