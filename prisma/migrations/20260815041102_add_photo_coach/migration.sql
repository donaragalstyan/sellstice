-- CreateEnum
CREATE TYPE "MissingShotType" AS ENUM ('BRAND_TAG', 'SIZE_TAG', 'MATERIAL_TAG', 'BACK_VIEW', 'FLAW_CLOSEUP', 'MODELED_PHOTO', 'FLAT_LAY');

-- CreateTable
CREATE TABLE "PhotoCoachAnalysis" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "missingShots" "MissingShotType"[],
    "modelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoCoachAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoCoachPhotoScore" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "photoOrder" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "isBestCover" BOOLEAN NOT NULL DEFAULT false,
    "lightingOk" BOOLEAN NOT NULL,
    "lightingFeedback" TEXT,
    "framingOk" BOOLEAN NOT NULL,
    "framingFeedback" TEXT,
    "backgroundOk" BOOLEAN NOT NULL,
    "backgroundFeedback" TEXT,
    "shapeVisibleOk" BOOLEAN NOT NULL,
    "shapeVisibleFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoCoachPhotoScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoCoachAnalysis_itemId_idx" ON "PhotoCoachAnalysis"("itemId");

-- CreateIndex
CREATE INDEX "PhotoCoachPhotoScore_analysisId_idx" ON "PhotoCoachPhotoScore"("analysisId");

-- CreateIndex
CREATE INDEX "PhotoCoachPhotoScore_photoId_idx" ON "PhotoCoachPhotoScore"("photoId");

-- AddForeignKey
ALTER TABLE "PhotoCoachAnalysis" ADD CONSTRAINT "PhotoCoachAnalysis_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoCoachPhotoScore" ADD CONSTRAINT "PhotoCoachPhotoScore_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "PhotoCoachAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoCoachPhotoScore" ADD CONSTRAINT "PhotoCoachPhotoScore_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ItemPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
