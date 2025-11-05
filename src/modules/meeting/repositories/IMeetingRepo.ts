import { Meeting } from "../domain/Meeting";

export interface IMeetingRepo {
  create(meeting: Meeting): Promise<{ success: boolean }>;
}
