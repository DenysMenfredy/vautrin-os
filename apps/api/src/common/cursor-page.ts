import { BadRequestException } from '@nestjs/common';
import type { PageResponse } from '@vautrin/contracts';

export const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PageCursor {
  readonly id: string;
  readonly createdAt: Date;
}

export function decodeCursor(value: string | undefined): PageCursor | null {
  if (value === undefined) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id)) throw new Error();
    if (typeof decoded.createdAt !== 'string') throw new Error();
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { id: decoded.id, createdAt };
  } catch {
    throw new BadRequestException('cursor is invalid.');
  }
}

export function cursorFilter(cursor: PageCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function buildPage<T extends { id: string; createdAt: Date }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): PageResponse<R> {
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

function encodeCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}
