import { Scheduling } from "../domain/Scheduling";

export class SchedulingMap {
  public static toDomain(raw: any): Scheduling {
    const scheduling = new Scheduling(raw);
    return scheduling;
  }
}
