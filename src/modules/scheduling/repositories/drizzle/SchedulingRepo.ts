import { eq } from "drizzle-orm";
import { db } from "../../../../shared/database/conn";
import { scheduling as schedulingTable } from "../../../../shared/database/schema";
import { Scheduling } from "../../domain/Scheduling";
import { ISchedulingRepo } from "../ISchedulingRepo";
import { BadRequestError, NotFoundError } from "../../../../shared/core/errors";
import { isUniqueViolation } from "../../../../shared/database/errors";
import { SchedulingMap } from "../../mappers/SchedulingMap";

export class SchedulingRepo implements ISchedulingRepo {
  async create(scheduling: Scheduling): Promise<{ success: boolean }> {
    let result;

    try {
      result = await db
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
    } catch (e: unknown) {
      // Two guests booking the same slot at the same time both pass every
      // check in the use case; the partial unique index is what actually
      // prevents the double booking.
      if (isUniqueViolation(e, "scheduling_active_slot_idx")) {
        throw new BadRequestError("This time slot is already booked");
      }
      throw e;
    }

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

  async getSchedulingsByHostId(hostId: string): Promise<Scheduling[]> {
    const schedulingsResponse = await db
      .select()
      .from(schedulingTable)
      .where(eq(schedulingTable.hostId, hostId));

    return schedulingsResponse.map((scheduling) =>
      SchedulingMap.toDomain(scheduling),
    );
  }
}
