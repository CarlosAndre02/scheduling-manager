import { db } from "../../../../shared/database/conn";
import { meetings } from "../../../../shared/database/schema";
import { Meeting } from "../../domain/Meeting";
import { IMeetingRepo } from "../IMeetingRepo";

export class MeetingRepo implements IMeetingRepo {
  async create(meeting: Meeting): Promise<{ success: boolean }> {
    const result = await db
      .insert(meetings)
      .values({
        id: meeting.id,
        name: meeting.name,
        description: meeting.description,
        start_datetime: meeting.start_datetime,
        end_datetime: meeting.end_datetime,
        meetingDurationInMinutes: meeting.meetingDurationInMinutes,
        conferenceLink: meeting.conferenceLink,
        isActive: meeting.isActive ?? true,
        userId: meeting.userId,
      })
      .returning();

    if (!result[0]) {
      return { success: false };
    }

    return { success: true };
  }
}
