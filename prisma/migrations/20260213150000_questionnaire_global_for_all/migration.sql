DO $$
BEGIN
  IF to_regclass('"Questionnaire"') IS NOT NULL THEN
    ALTER TABLE "Questionnaire"
      ADD COLUMN IF NOT EXISTS "globalForAllUsers" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
