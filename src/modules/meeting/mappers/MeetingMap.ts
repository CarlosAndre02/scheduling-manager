import { Meeting } from "../domain/Meeting";

export class MeetingMap {
  public static toDomain(raw: any): Meeting {
    const meeting = new Meeting(raw);
    return meeting;
  }
}
