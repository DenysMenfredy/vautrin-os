import { EMBEDDING_DIMENSIONS } from './config.js';
import { SchemaMismatchError } from './errors.js';
import type { TenantScopedClient } from './tenant-context.js';

/**
 * pgvector access for knowledge_chunks.
 *
 * Prisma has no native mapping for the `vector` type, so the column is
 * declared `Unsupported(...)` in the schema and read/written here through raw
 * SQL. Keeping every raw vector statement in this one module is what stops
 * `::vector` casts from spreading across the codebase.
 *
 * Everything here takes a tenant-scoped transaction client. RLS already
 * constrains the rows, and the queries still filter on tenant_id explicitly —
 * AGENTS.md §3: "Every repository query must be tenant-aware." Belt and
 * braces, deliberately.
 */

/**
 * Formats a vector for PostgreSQL: `[0.1,0.2,0.3]`.
 *
 * Validates length and finiteness here rather than letting PostgreSQL reject
 * the literal, because the error it produces names neither the row nor the
 * document being embedded.
 */
export function toVectorLiteral(values: readonly number[]): string {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new SchemaMismatchError(
      `Embedding has ${values.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`,
    );
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new SchemaMismatchError(
        `Embedding contains a non-finite value (${value}); check the provider response before persisting.`,
      );
    }
  }

  return `[${values.join(',')}]`;
}

export interface UpsertChunkInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly embedding: readonly number[];
  readonly tokenCount?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Writes one chunk and its embedding.
 *
 * Upsert on (tenant_id, document_id, chunk_index) so re-running the embedding
 * pipeline over an unchanged document is idempotent (VOS-076).
 */
export async function upsertKnowledgeChunk(
  tx: TenantScopedClient,
  input: UpsertChunkInput,
): Promise<{ id: string }> {
  const literal = toVectorLiteral(input.embedding);
  const metadata = JSON.stringify(input.metadata ?? {});

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO knowledge_chunks (
      tenant_id, document_id, chunk_index, content, embedding, token_count, metadata
    )
    VALUES (
      ${input.tenantId}::uuid,
      ${input.documentId}::uuid,
      ${input.chunkIndex},
      ${input.content},
      ${literal}::vector,
      ${input.tokenCount ?? null},
      ${metadata}::jsonb
    )
    ON CONFLICT (tenant_id, document_id, chunk_index) DO UPDATE
      SET content     = EXCLUDED.content,
          embedding   = EXCLUDED.embedding,
          token_count = EXCLUDED.token_count,
          metadata    = EXCLUDED.metadata
    RETURNING id::text AS id
  `;

  const row = rows[0];
  if (!row) {
    throw new SchemaMismatchError('Chunk upsert returned no row.');
  }
  return row;
}

export interface SearchOptions {
  readonly tenantId: string;
  readonly embedding: readonly number[];
  readonly limit?: number;
  /** Restricts the search to one document. */
  readonly documentId?: string;
  /** Drops results below this cosine similarity (0..1). */
  readonly minSimilarity?: number;
  /**
   * Enables pgvector's iterative index scan.
   *
   * With a tenant filter on a shared HNSW index, a plain ANN scan can return
   * fewer rows than requested because the filter is applied after the index
   * returns its candidates. Iterative scanning keeps pulling candidates until
   * the limit is satisfied. Requires pgvector >= 0.8; off by default so this
   * package does not silently depend on it.
   */
  readonly iterativeScan?: boolean;
}

export interface KnowledgeSearchResult {
  readonly id: string;
  readonly documentId: string;
  readonly content: string;
  readonly chunkIndex: number;
  readonly metadata: Record<string, unknown>;
  /** Cosine similarity, 1 = identical. */
  readonly similarity: number;
}

/**
 * Tenant-filtered semantic retrieval (VOS-077, SDD-06 §6).
 *
 * `<=>` is cosine distance, matching the operator class on the HNSW index;
 * similarity is reported as `1 - distance` so callers can threshold on an
 * intuitive scale.
 *
 * SDD-06 §6 is worth restating here: this is for unstructured knowledge only.
 * Appointment availability, lead status, and customer identity come from
 * relational queries, never from retrieval.
 */
export async function searchKnowledgeChunks(
  tx: TenantScopedClient,
  options: SearchOptions,
): Promise<KnowledgeSearchResult[]> {
  const literal = toVectorLiteral(options.embedding);
  const limit = options.limit ?? 8;
  const minSimilarity = options.minSimilarity ?? 0;

  if (options.iterativeScan === true) {
    await tx.$executeRaw`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
  }

  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      document_id: string;
      content: string;
      chunk_index: number;
      metadata: Record<string, unknown>;
      similarity: number;
    }>
  >`
    SELECT
      kc.id::text          AS id,
      kc.document_id::text AS document_id,
      kc.content           AS content,
      kc.chunk_index       AS chunk_index,
      kc.metadata          AS metadata,
      1 - (kc.embedding <=> ${literal}::vector) AS similarity
    FROM knowledge_chunks kc
    WHERE kc.tenant_id = ${options.tenantId}::uuid
      AND kc.embedding IS NOT NULL
      AND (${options.documentId ?? null}::uuid IS NULL OR kc.document_id = ${options.documentId ?? null}::uuid)
      AND 1 - (kc.embedding <=> ${literal}::vector) >= ${minSimilarity}
    ORDER BY kc.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    metadata: row.metadata,
    similarity: Number(row.similarity),
  }));
}
