-- Follow-up to 20261013000100_events.sql: the punctuation-deleted copy of the text turned an apostrophe contraction
-- ("who're", "who’re") into the denylisted word "whore". Apostrophes now become spaces before the other punctuation
-- is deleted, so contractions stay two words. A third copy catches the joined-letter evasions that change leaves
-- open: any run of SINGLE letters/digits separated by punctuation or apostrophes ("f'u'c'k", "f’u’c’k", "f.u.c.k",
-- "f-u-c-k", a zero-width character between letters) is joined into one token and checked too. Multi-letter pieces
-- are never joined, so "who're", "we're", "it's" stay apart. Same signature; callers are unchanged.
create or replace function private.has_blocked_term(p text) returns boolean
language sql stable set search_path = '' as $$
  with s as (select lower(coalesce(p, '')) as v),
  joined as (
    select coalesce(string_agg(regexp_replace(m[1], '[^a-z0-9]', '', 'g'), ' '), '') as j
      from s, regexp_matches(s.v, '(\m[a-z0-9](?:[^a-z0-9[:space:]]+[a-z0-9])+\M)', 'g') as m
  )
  select exists (select 1 from private.blocked_terms t, s, joined
                  where regexp_replace(s.v, '[^a-z0-9]+', ' ', 'g') ~ ('\m' || t.term || '\M')
                     or btrim(regexp_replace(regexp_replace(regexp_replace(s.v, '[''’‘`]', ' ', 'g'),
                                                            '[^a-z0-9 ]', '', 'g'), ' +', ' ', 'g'))
                        ~ ('\m' || t.term || '\M')
                     or joined.j ~ ('\m' || t.term || '\M'))
$$;
