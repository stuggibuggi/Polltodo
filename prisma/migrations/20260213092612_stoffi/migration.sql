/*
  Warnings:

  - A unique constraint covering the columns `[externalId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM_DAYS');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CLOSED_BY_OTHER');

-- AlterTable
ALTER TABLE "GroupQuestionnaire" ADD COLUMN     "activeFrom" TIMESTAMP(3),
ADD COLUMN     "activeTo" TIMESTAMP(3),
ADD COLUMN     "frequency" "Frequency" NOT NULL DEFAULT 'ONCE',
ADD COLUMN     "intervalDays" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "imported" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ObjectEntity" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectRoleAssignment" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectSurveyPolicy" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "intervalDays" INTEGER,
    "roleIds" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdByGroupId" TEXT,
    "createdByObjectGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectSurveyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupObjectGroup" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "objectGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupObjectGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectGroupMembership" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectGroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectGroupRule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectGroupRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectGroupPolicy" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "intervalDays" INTEGER,
    "roleNames" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectGroupPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectPolicyOverride" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "intervalDays" INTEGER,
    "roleIds" JSONB NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectPolicyOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectSurveyTask" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3),
    "startedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectSurveyTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ObjectEntity_externalId_key" ON "ObjectEntity"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectEntity_name_key" ON "ObjectEntity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefinition_name_key" ON "RoleDefinition"("name");

-- CreateIndex
CREATE INDEX "ObjectRoleAssignment_objectId_idx" ON "ObjectRoleAssignment"("objectId");

-- CreateIndex
CREATE INDEX "ObjectRoleAssignment_roleId_idx" ON "ObjectRoleAssignment"("roleId");

-- CreateIndex
CREATE INDEX "ObjectSurveyPolicy_createdByGroupId_idx" ON "ObjectSurveyPolicy"("createdByGroupId");

-- CreateIndex
CREATE INDEX "ObjectSurveyPolicy_createdByObjectGroupId_idx" ON "ObjectSurveyPolicy"("createdByObjectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectGroup_name_key" ON "ObjectGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "GroupObjectGroup_groupId_objectGroupId_key" ON "GroupObjectGroup"("groupId", "objectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectGroupMembership_objectId_groupId_key" ON "ObjectGroupMembership"("objectId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectSurveyTask_submissionId_key" ON "ObjectSurveyTask"("submissionId");

-- CreateIndex
CREATE INDEX "ObjectSurveyTask_policyId_objectId_idx" ON "ObjectSurveyTask"("policyId", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- AddForeignKey
ALTER TABLE "ObjectRoleAssignment" ADD CONSTRAINT "ObjectRoleAssignment_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectRoleAssignment" ADD CONSTRAINT "ObjectRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectRoleAssignment" ADD CONSTRAINT "ObjectRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectRoleAssignment" ADD CONSTRAINT "ObjectRoleAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyPolicy" ADD CONSTRAINT "ObjectSurveyPolicy_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyPolicy" ADD CONSTRAINT "ObjectSurveyPolicy_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupObjectGroup" ADD CONSTRAINT "GroupObjectGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupObjectGroup" ADD CONSTRAINT "GroupObjectGroup_objectGroupId_fkey" FOREIGN KEY ("objectGroupId") REFERENCES "ObjectGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectGroupMembership" ADD CONSTRAINT "ObjectGroupMembership_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectGroupMembership" ADD CONSTRAINT "ObjectGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ObjectGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectGroupRule" ADD CONSTRAINT "ObjectGroupRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ObjectGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectGroupPolicy" ADD CONSTRAINT "ObjectGroupPolicy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ObjectGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectGroupPolicy" ADD CONSTRAINT "ObjectGroupPolicy_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectPolicyOverride" ADD CONSTRAINT "ObjectPolicyOverride_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectPolicyOverride" ADD CONSTRAINT "ObjectPolicyOverride_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ObjectSurveyPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "ObjectEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectSurveyTask" ADD CONSTRAINT "ObjectSurveyTask_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
