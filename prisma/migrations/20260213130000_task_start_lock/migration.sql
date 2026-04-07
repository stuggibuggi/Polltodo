-- Add optimistic start-lock metadata for object survey tasks.
-- Some environments have an old baseline migration history where this table
-- does not exist in the shadow DB. Guard all operations accordingly.
DO $$
BEGIN
  IF to_regclass('"ObjectSurveyTask"') IS NOT NULL THEN
    ALTER TABLE "ObjectSurveyTask"
      ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "startedByUserId" TEXT;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'ObjectSurveyTask_startedByUserId_fkey'
    ) THEN
      ALTER TABLE "ObjectSurveyTask"
        ADD CONSTRAINT "ObjectSurveyTask_startedByUserId_fkey"
        FOREIGN KEY ("startedByUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    CREATE INDEX IF NOT EXISTS "ObjectSurveyTask_startedByUserId_idx"
      ON "ObjectSurveyTask"("startedByUserId");
  END IF;
END $$;
