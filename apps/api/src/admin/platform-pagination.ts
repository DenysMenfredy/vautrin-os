import { BadRequestException } from '@nestjs/common';
import type { PageResponse } from '@vautrin/contracts';

export function cursorWhere(cursor: string | undefined, sort = 'createdAt:desc') {
  if (!cursor) return {};
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      !('at' in value) ||
      !('sort' in value) ||
      typeof value.id !== 'string' ||
      typeof value.at !== 'string' ||
      value.sort !== sort ||
      !/^[0-9a-f-]{36}$/i.test(value.id)
    )
      throw new Error();
    const at = new Date(value.at);
    if (Number.isNaN(at.getTime())) throw new Error();
    return sort === 'createdAt:asc'
      ? { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: value.id } }] }
      : { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: value.id } }] };
  } catch {
    throw new BadRequestException('Invalid pagination cursor.');
  }
}
export function platformPage<T extends { id: string; createdAt: Date }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
  sort = 'createdAt:desc',
): PageResponse<R> {
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return {
    items: selected.map(map),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, at: last.createdAt.toISOString(), sort }),
          ).toString('base64url')
        : null,
  };
}
export function createdRange(from?: string, to?: string) {
  if (from && to && new Date(from) > new Date(to))
    throw new BadRequestException('The start date must precede the end date.');
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to) } : {}),
  };
}
