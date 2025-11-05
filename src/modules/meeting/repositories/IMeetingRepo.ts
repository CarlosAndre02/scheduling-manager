import { Meeting } from "../domain/Meeting";

export interface IMeetingRepo {
  create(meeting: Meeting): Promise<{ success: boolean }>;
  getMeetingByMeetingId(meetingId: string): Promise<Meeting>;
  getMeetingsByUserId(userId: string): Promise<Meeting[]>;
}
