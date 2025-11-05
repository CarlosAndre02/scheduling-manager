import { eq } from "drizzle-orm";
import { db } from "../../../../shared/database/conn";
import { meetings } from "../../../../shared/database/schema";
import { Meeting } from "../../domain/Meeting";
import { IMeetingRepo } from "../IMeetingRepo";
import { NotFoundError } from "../../../../shared/core/errors";
import { MeetingMap } from "../../mappers/MeetingMap";

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

  async getMeetingByMeetingId(meetingId: string): Promise<Meeting> {
    const meetingResponse = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1);
    if (!meetingResponse[0]) throw new NotFoundError("Meeting not found.");

    return MeetingMap.toDomain(meetingResponse[0]);
  }

  async getMeetingsByUserId(userId: string): Promise<Meeting[]> {
    const meetingsResponse = await db
      .select()
      .from(meetings)
      .where(eq(meetings.userId, userId));

    return meetingsResponse.map((meeting) => MeetingMap.toDomain(meeting));
  }
}
