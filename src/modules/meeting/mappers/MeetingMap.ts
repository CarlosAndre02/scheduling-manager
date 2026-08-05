import { Meeting, MeetingProps } from "../domain/Meeting";

export class MeetingMap {
  public static toDomain(raw: MeetingProps): Meeting {
    const meeting = new Meeting(raw);
    return meeting;
  }
}
