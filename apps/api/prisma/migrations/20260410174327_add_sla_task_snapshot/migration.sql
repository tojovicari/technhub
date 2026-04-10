-- CreateTable
CREATE TABLE "SlaTaskSnapshot" (
    "taskId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigneeId" TEXT,
    "priority" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaTaskSnapshot_pkey" PRIMARY KEY ("taskId")
);

-- CreateIndex
CREATE INDEX "SlaTaskSnapshot_tenantId_idx" ON "SlaTaskSnapshot"("tenantId");
