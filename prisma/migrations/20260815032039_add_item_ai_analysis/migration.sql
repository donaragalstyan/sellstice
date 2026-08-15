-- CreateTable
CREATE TABLE "ItemAIAnalysis" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "brandValue" TEXT,
    "brandConfidence" DOUBLE PRECISION,
    "colorValue" TEXT,
    "colorConfidence" DOUBLE PRECISION,
    "itemTypeValue" TEXT,
    "itemTypeConfidence" DOUBLE PRECISION,
    "categoryValue" TEXT,
    "categoryConfidence" DOUBLE PRECISION,
    "conditionValue" "ItemCondition",
    "conditionConfidence" DOUBLE PRECISION,
    "styleKeywords" TEXT[],
    "visibleDetails" TEXT[],
    "missingPhotoSuggestions" TEXT[],
    "appliedFields" TEXT[],
    "modelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemAIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemAIAnalysis_itemId_idx" ON "ItemAIAnalysis"("itemId");

-- AddForeignKey
ALTER TABLE "ItemAIAnalysis" ADD CONSTRAINT "ItemAIAnalysis_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
