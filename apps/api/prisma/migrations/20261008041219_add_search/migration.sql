-- Full-text search for tournament discovery; trigram indexes for team/player name search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "tournaments" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("region", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("description", '')), 'C')
) STORED;

CREATE INDEX "tournaments_search_idx" ON "tournaments" USING GIN ("search");
CREATE INDEX "teams_name_trgm_idx" ON "teams" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "players_display_name_trgm_idx" ON "players" USING GIN ("displayName" gin_trgm_ops);
