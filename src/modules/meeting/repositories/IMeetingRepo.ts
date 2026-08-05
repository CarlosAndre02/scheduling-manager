import { Pagination } from "../../../shared/core/Pagination";
import { Meeting } from "../domain/Meeting";

export interface IMeetingRepo {
  create(meeting: Meeting): Promise<void>;
  getMeetingByMeetingId(meetingId: string): Promise<Meeting>;
  getMeetingsByUserId(
    userId: string,
    pagination: Pagination,
  ): Promise<Meeting[]>;
}
