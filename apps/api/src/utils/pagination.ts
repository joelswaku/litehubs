import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Reusable query schema for any list endpoint. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export function toPagination(input: {
  page: number;
  limit: number;
}): Pagination {
  return {
    page: input.page,
    limit: input.limit,
    offset: (input.page - 1) * input.limit,
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  pagination: Pagination,
): Paginated<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pagination.limit);
  return {
    data,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrevious: pagination.page > 1,
    },
  };
}
