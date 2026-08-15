-- CreateEnum
CREATE TYPE "ComparableSource" AS ENUM ('WEB_SEARCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "ComparablePriceType" AS ENUM ('ASKING', 'SOLD', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ComparableResearchRun" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "querySnapshot" JSONB NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparableResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparableListing" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "researchRunId" TEXT,
    "source" "ComparableSource" NOT NULL,
    "title" TEXT NOT NULL,
    "marketplace" TEXT,
    "priceCents" INTEGER,
    "priceType" "ComparablePriceType" NOT NULL DEFAULT 'UNKNOWN',
    "url" TEXT,
    "condition" TEXT,
    "recency" TEXT,
    "confidence" DOUBLE PRECISION,
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparableListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComparableResearchRun_itemId_idx" ON "ComparableResearchRun"("itemId");

-- CreateIndex
CREATE INDEX "ComparableListing_itemId_idx" ON "ComparableListing"("itemId");

-- CreateIndex
CREATE INDEX "ComparableListing_researchRunId_idx" ON "ComparableListing"("researchRunId");

-- AddForeignKey
ALTER TABLE "ComparableResearchRun" ADD CONSTRAINT "ComparableResearchRun_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableListing" ADD CONSTRAINT "ComparableListing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableListing" ADD CONSTRAINT "ComparableListing_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ComparableResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
