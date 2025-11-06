import { db } from "../../../../shared/database/conn";
import { scheduling as schedulingTable } from "../../../../shared/database/schema";
import { Scheduling } from "../../domain/Scheduling";
import { ISchedulingRepo } from "../ISchedulingRepo";

export class SchedulingRepo implements ISchedulingRepo {
  async create(scheduling: Scheduling): Promise<{ success: boolean }> {
    const result = await db
      .insert(schedulingTable)
      .values({
        id: scheduling.id,
        schedulingDatetime: scheduling.schedulingDatetime,
        name: scheduling.name,
        purpose: scheduling.purpose,
        isActive: scheduling.isActive ?? true,
        hostId: scheduling.hostId,
        guestId: scheduling.guestId,
        meetingId: scheduling.meetingId,
      })
      .returning();

    if (!result[0]) {
      return { success: false };
    }

    return { success: true };
  }
}
