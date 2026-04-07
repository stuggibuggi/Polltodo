-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "editorMenuConfig" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("id")
);
