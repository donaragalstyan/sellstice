-- CreateEnum
CREATE TYPE "SellTimingStance" AS ENUM ('SELL_NOW', 'WAIT');

-- CreateTable
CREATE TABLE "SellTimingAnalysis" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "stance" "SellTimingStance" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellTimingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellTimingAnalysis_itemId_idx" ON "SellTimingAnalysis"("itemId");

-- AddForeignKey
ALTER TABLE "SellTimingAnalysis" ADD CONSTRAINT "SellTimingAnalysis_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
