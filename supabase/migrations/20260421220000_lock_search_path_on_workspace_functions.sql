-- Lock search_path on the two functions added in 20260422120000 so they match
-- Supabase's security advisor (`function_search_path_mutable` lint, rule 0011).
-- Without SET search_path, a superuser-owned function can be coerced into
-- resolving unqualified names against a hostile schema in the caller's
-- search_path. Pin to `public, pg_catalog` so only real schema objects match.

ALTER FUNCTION public.workspace_chat_retrieval(
  UUID, UUID, TEXT, vector(1536), INT, FLOAT, FLOAT, FLOAT, INT
) SET search_path = public, pg_catalog;

ALTER FUNCTION public.conversation_attached_document_ids(UUID)
  SET search_path = public, pg_catalog;
