import { Pagination } from "../../../shared/core/Pagination";
import { Scheduling } from "../domain/Scheduling";

export interface ISchedulingRepo {
  create(scheduling: Scheduling): Promise<void>;
  getSchedulingBySchedulingId(schedulingId: string): Promise<Scheduling>;
  getSchedulingsByHostId(
    hostId: string,
    pagination: Pagination,
  ): Promise<Scheduling[]>;
}
