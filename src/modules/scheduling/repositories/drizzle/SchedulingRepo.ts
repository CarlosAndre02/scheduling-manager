import { eq } from "drizzle-orm";
import { db } from "../../../../shared/database/conn";
import { scheduling as schedulingTable } from "../../../../shared/database/schema";
import { Scheduling } from "../../domain/Scheduling";
import { ISchedulingRepo } from "../ISchedulingRepo";
import { NotFoundError } from "../../../../shared/core/errors";
import { SchedulingMap } from "../../mappers/SchedulingMap";

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

  async getSchedulingBySchedulingId(schedulingId: string): Promise<Scheduling> {
    const schedulingResponse = await db
      .select()
      .from(schedulingTable)
      .where(eq(schedulingTable.id, schedulingId))
      .limit(1);
    if (!schedulingResponse[0])
      throw new NotFoundError("Scheduling not found.");

    return SchedulingMap.toDomain(schedulingResponse[0]);
  }
}
