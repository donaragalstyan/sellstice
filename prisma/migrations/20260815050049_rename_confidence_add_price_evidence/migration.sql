/*
  Warnings:

  - You are about to drop the column `confidence` on the `ComparableListing` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ComparablePriceEvidence" AS ENUM ('STRUCTURED_DATA', 'META_TAG', 'MICRODATA', 'UNVERIFIED', 'BLOCKED');

-- AlterTable
ALTER TABLE "ComparableListing" DROP COLUMN "confidence",
ADD COLUMN     "matchConfidence" DOUBLE PRECISION,
ADD COLUMN     "priceEvidence" "ComparablePriceEvidence";
