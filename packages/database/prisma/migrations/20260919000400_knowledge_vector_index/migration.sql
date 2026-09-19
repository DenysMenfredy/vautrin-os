-- ---------------------------------------------------------------------------
-- Semantic retrieval index for knowledge_chunks (ADR-004, SDD-06 §6)
--
-- HNSW rather than IVFFlat: it needs no training pass, so it behaves sanely
-- on a table that starts empty and grows per tenant, which is exactly the
-- shape here. m=16 / ef_construction=64 are the pgvector defaults and a
-- reasonable starting point; SDD-04 §6 requires validating this against real
-- query plans before it is treated as final.
--
-- Cosine distance is the default because the embedding providers we target
-- return normalized vectors. Changing the distance function means changing
-- this operator class AND the query operator together (<=> is cosine).
--
-- Tenant filtering interacts with ANN search: `WHERE tenant_id = $1` is
-- applied around the index scan, so a selective tenant on a large shared
-- index can under-fill the result set. pgvector 0.8 mitigates this with
-- iterative index scans (hnsw.iterative_scan). src/vector.ts sets that,
-- and the retrieval path must keep verifying tenant_id on the rows it gets
-- back — RLS already enforces it, the index is only an accelerator.
-- ---------------------------------------------------------------------------

CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX public.knowledge_chunks_embedding_hnsw_idx IS
  'ANN index for tenant knowledge retrieval. Rebuild with CREATE INDEX CONCURRENTLY when the table is non-trivial.';
