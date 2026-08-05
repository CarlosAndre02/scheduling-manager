import { Pagination } from "../../../../shared/core/Pagination";

export type GetSchedulingsByHostIdDTO = {
  hostId: string;
  pagination: Pagination;
};
