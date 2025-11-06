import { v4 as uuidV4 } from "uuid";
import { Guard } from "../../../shared/core/Guard";
import { BadRequestError } from "../../../shared/core/errors";

export type SchedulingProps = {
  id?: string;
  schedulingDatetime: Date;
  name: string;
  purpose: string;
  isActive?: boolean;
  hostId: string;
  guestId: string;
  meetingId: string;
  updated_at?: Date | null;
  created_at?: Date;
};

export class Scheduling {
  public readonly id: string;
  public readonly schedulingDatetime: Date;
  public readonly name: string;
  public readonly purpose: string;
  public readonly isActive: boolean;
  public readonly hostId: string;
  public readonly guestId: string;
  public readonly meetingId: string;
  public readonly updated_at?: Date | null;
  public readonly created_at?: Date;

  public constructor(scheduling: SchedulingProps) {
    scheduling.id = scheduling.id ?? uuidV4();
    scheduling.isActive = scheduling.isActive ?? true;

    this.validate(scheduling);

    this.id = scheduling.id;
    this.schedulingDatetime = scheduling.schedulingDatetime;
    this.name = scheduling.name;
    this.purpose = scheduling.purpose;
    this.isActive = scheduling.isActive;
    this.hostId = scheduling.hostId;
    this.guestId = scheduling.guestId;
    this.meetingId = scheduling.meetingId;
    this.updated_at = scheduling.updated_at;
    this.created_at = scheduling.created_at;
  }

  private validate(scheduling: SchedulingProps) {
    Guard.againstNullOrUndefinedBulk([
      {
        argument: scheduling.schedulingDatetime,
        argumentName: "schedulingDatetime",
      },
      { argument: scheduling.name, argumentName: "name" },
      { argument: scheduling.purpose, argumentName: "purpose" },
      { argument: scheduling.hostId, argumentName: "hostId" },
      { argument: scheduling.guestId, argumentName: "guestId" },
      { argument: scheduling.meetingId, argumentName: "meetingId" },
    ]);

    if (!Scheduling.isValidName(scheduling.name))
      throw new BadRequestError("Name should be between 3 and 50 characters");

    if (!Scheduling.isValidPurpose(scheduling.purpose))
      throw new BadRequestError(
        "Purpose should be between 3 and 100 characters",
      );

    if (!Scheduling.isValidDate(scheduling.schedulingDatetime))
      throw new BadRequestError("schedulingDatetime must be a valid datetime");

    if (scheduling.hostId === scheduling.guestId)
      throw new BadRequestError("hostId and guestId must be different");
  }

  public static isValidName(name: string) {
    return name.length >= 3 && name.length <= 50;
  }

  public static isValidPurpose(purpose: string) {
    return purpose.length >= 3 && purpose.length <= 100;
  }

  public static isValidDate(date: Date) {
    return date instanceof Date && !isNaN(date.valueOf());
  }
}
