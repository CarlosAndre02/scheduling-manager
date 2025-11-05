export interface CreateMeetingDTO {
  name: string;
  description: string;
  start_datetime: string;
  end_datetime: string;
  meetingDurationInMinutes: number;
  conferenceLink: string;
  userId: string;
}
