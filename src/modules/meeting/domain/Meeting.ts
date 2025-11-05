import { Guard } from "../../../shared/core/Guard";
import { BadRequestError } from "../../../shared/core/errors";
import { TextUtils } from "../../../shared/utils/TextUtils";

import { v4 as uuidV4 } from "uuid";

export type MeetingProps = {
  id?: string;
  name: string;
  description: string;
  start_datetime: Date;
  end_datetime: Date;
  meetingDurationInMinutes: number;
  conferenceLink: string;
  isActive: boolean;
  userId: string;
  updated_at?: Date | null;
  created_at?: Date;
};

export class Meeting {
  public readonly id: string;
  public readonly name: string;
  public readonly description: string;
  public readonly start_datetime: Date;
  public readonly end_datetime: Date;
  public readonly meetingDurationInMinutes: number;
  public readonly conferenceLink: string;
  public readonly isActive: boolean;
  public readonly userId: string;
  public readonly updated_at?: Date | null;
  public readonly created_at?: Date;

  public constructor(meeting: MeetingProps) {
    meeting.id = meeting.id ?? uuidV4();
    meeting.isActive = meeting.isActive ?? true;

    this.validate(meeting);

    this.id = meeting.id;
    this.name = meeting.name;
    this.description = meeting.description;
    this.start_datetime = meeting.start_datetime;
    this.end_datetime = meeting.end_datetime;
    this.meetingDurationInMinutes = meeting.meetingDurationInMinutes;
    this.conferenceLink = meeting.conferenceLink;
    this.isActive = meeting.isActive;
    this.userId = meeting.userId;
    this.updated_at = meeting.updated_at;
    this.created_at = meeting.created_at;
  }

  private validate(meeting: MeetingProps) {
    Guard.againstNullOrUndefinedBulk([
      { argument: meeting.name, argumentName: "name" },
      { argument: meeting.description, argumentName: "description" },
      { argument: meeting.start_datetime, argumentName: "start_datetime" },
      { argument: meeting.end_datetime, argumentName: "end_datetime" },
      {
        argument: meeting.meetingDurationInMinutes,
        argumentName: "meetingDurationInMinutes",
      },
      { argument: meeting.conferenceLink, argumentName: "conferenceLink" },
      { argument: meeting.userId, argumentName: "userId" },
    ]);

    if (!Meeting.isValidName(meeting.name))
      throw new BadRequestError("Name should be between 3 and 50 characters");

    if (!Meeting.isValidDescription(meeting.description))
      throw new BadRequestError(
        "Description should be between 3 and 100 characters",
      );

    if (!Meeting.isValidUTCDate(meeting.start_datetime))
      throw new BadRequestError("start_datetime must be a valid UTC datetime");
    if (!Meeting.isValidUTCDate(meeting.end_datetime))
      throw new BadRequestError("end_datetime must be a valid UTC datetime");
    if (meeting.end_datetime <= meeting.start_datetime)
      throw new BadRequestError("end_datetime must be after start_datetime");

    if (!Meeting.isValidDuration(meeting.meetingDurationInMinutes))
      throw new BadRequestError(
        "meetingDurationInMinutes must be at least 1 minute",
      );

    if (!Meeting.isValidUrl(meeting.conferenceLink))
      throw new BadRequestError("conferenceLink must be a valid URL");
  }

  public static isValidName(name: string) {
    return name.length >= 3 && name.length <= 50;
  }

  public static isValidDescription(description: string) {
    return description.length >= 3 && description.length <= 100;
  }

  public static isValidUTCDate(date: Date) {
    return date instanceof Date && !isNaN(date.valueOf());
  }

  public static isValidDuration(minutes: number) {
    return Number.isInteger(minutes) && minutes >= 1;
  }

  public static isValidUrl(url: string) {
    return TextUtils.validateWebURL(url);
  }
}
