-- AlterTable
ALTER TABLE "IntegrationConnection" ADD COLUMN     "typeMapping" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "originalType" TEXT,
ALTER COLUMN "taskType" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
