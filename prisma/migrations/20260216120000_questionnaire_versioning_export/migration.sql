-- Add questionnaire versioning and submission snapshot metadata
ALTER TABLE "Questionnaire"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Submission"
  ADD COLUMN IF NOT EXISTS "questionnaireVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "questionnaireSnapshot" JSONB;
