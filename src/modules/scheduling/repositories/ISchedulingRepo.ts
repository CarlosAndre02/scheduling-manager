import { Scheduling } from "../domain/Scheduling";

export interface ISchedulingRepo {
  create(scheduling: Scheduling): Promise<{ success: boolean }>;
  getSchedulingBySchedulingId(schedulingId: string): Promise<Scheduling>;
  getSchedulingsByHostId(hostId: string): Promise<Scheduling[]>;
}
