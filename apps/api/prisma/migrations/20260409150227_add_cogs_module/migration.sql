-- CreateEnum
CREATE TYPE "CogsCategory" AS ENUM ('engineering', 'overhead', 'tooling', 'cloud', 'administrative', 'other');

-- CreateEnum
CREATE TYPE "CogsSource" AS ENUM ('timetracking', 'story_points', 'estimate', 'manual');

-- CreateEnum
CREATE TYPE "CogsConfidence" AS ENUM ('high', 'medium', 'low');

-- CreateTable
CREATE TABLE "CogsEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "projectId" TEXT,
    "epicId" TEXT,
    "taskId" TEXT,
    "hoursWorked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hourlyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overheadRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "category" "CogsCategory" NOT NULL,
    "subcategory" TEXT,
    "source" "CogsSource" NOT NULL,
    "confidence" "CogsConfidence" NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "approvedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CogsBudget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "teamId" TEXT,
    "period" TEXT NOT NULL,
    "budgetAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_idx" ON "CogsEntry"("tenantId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_periodDate_idx" ON "CogsEntry"("tenantId", "periodDate");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_projectId_idx" ON "CogsEntry"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_epicId_idx" ON "CogsEntry"("tenantId", "epicId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_taskId_idx" ON "CogsEntry"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_userId_idx" ON "CogsEntry"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_teamId_idx" ON "CogsEntry"("tenantId", "teamId");

-- CreateIndex
CREATE INDEX "CogsEntry_tenantId_category_idx" ON "CogsEntry"("tenantId", "category");

-- CreateIndex
CREATE INDEX "CogsBudget_tenantId_idx" ON "CogsBudget"("tenantId");

-- CreateIndex
CREATE INDEX "CogsBudget_tenantId_period_idx" ON "CogsBudget"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CogsBudget_tenantId_projectId_teamId_period_key" ON "CogsBudget"("tenantId", "projectId", "teamId", "period");
