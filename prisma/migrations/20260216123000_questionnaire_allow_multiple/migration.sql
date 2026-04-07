-- Allow repeated submissions per questionnaire
ALTER TABLE "Questionnaire"
  ADD COLUMN IF NOT EXISTS "allowMultipleSubmissions" BOOLEAN NOT NULL DEFAULT false;
