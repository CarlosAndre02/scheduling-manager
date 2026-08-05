import { Scheduling, SchedulingProps } from "../domain/Scheduling";

export class SchedulingMap {
  public static toDomain(raw: SchedulingProps): Scheduling {
    const scheduling = new Scheduling(raw);
    return scheduling;
  }
}
