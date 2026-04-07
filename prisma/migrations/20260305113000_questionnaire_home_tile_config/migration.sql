ALTER TABLE "Questionnaire"
ADD COLUMN IF NOT EXISTS "homeTileDescriptionHtml" TEXT;

ALTER TABLE "Questionnaire"
ADD COLUMN IF NOT EXISTS "homeTileColor" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "Questionnaire"
ADD COLUMN IF NOT EXISTS "homeTileAttributes" JSONB NOT NULL DEFAULT '[]'::jsonb;
