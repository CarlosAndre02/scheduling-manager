import { Pagination } from "../../../../shared/core/Pagination";

export type GetMeetingsByUserIdDTO = {
  userId: string;
  pagination: Pagination;
};
