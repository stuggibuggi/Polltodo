-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
