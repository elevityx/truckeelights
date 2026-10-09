-- Follow-up to 20261013000100_events.sql: the punctuation-deleted copy of the text turned an apostrophe contraction
-- ("who're", "who’re") into the denylisted word "whore". Apostrophes now become spaces before the other punctuation
-- is deleted, so contractions stay two words while joined-letter evasions ("f.u.c.k", "f-u-c-k", a zero-width space
-- inside a word) still collapse to the blocked word. Same signature; callers are unchanged.
create or replace function private.has_blocked_term(p text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.blocked_terms t
                  where regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g') ~ ('\m' || t.term || '\M')
                     or btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[''’‘`]', ' ', 'g'),
                                                            '[^a-z0-9 ]', '', 'g'), ' +', ' ', 'g'))
                        ~ ('\m' || t.term || '\M'))
$$;
