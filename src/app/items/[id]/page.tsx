import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getItemDisplayLabel } from "@/lib/item-display";
import { ItemForm } from "../item-form";
import { DeleteItemButton } from "./delete-item-button";
import { PhotoGallery } from "./photo-gallery";
import { PhotoUploadForm } from "./photo-upload-form";
import { AiSuggestions } from "./ai-suggestions";
import { PhotoCoach } from "./photo-coach";
import { MarketResearch } from "./market-research";
import { SellTiming } from "./sell-timing";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;

  const item = await prisma.item.findUnique({
    where: { id },
    include: { photos: { orderBy: { order: "asc" } } },
  });

  if (!item || item.userId !== userId) {
    notFound();
  }

  const latestAnalysis = await prisma.itemAIAnalysis.findFirst({
    where: { itemId: item.id },
    orderBy: { createdAt: "desc" },
  });

  const latestPhotoCoachAnalysis = await prisma.photoCoachAnalysis.findFirst({
    where: { itemId: item.id },
    orderBy: { createdAt: "desc" },
    include: { scores: { include: { photo: true } } },
  });

  const comparables = await prisma.comparableListing.findMany({
    where: { itemId: item.id },
    orderBy: { createdAt: "desc" },
  });

  const latestSellTimingAnalysis = await prisma.sellTimingAnalysis.findFirst({
    where: { itemId: item.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/items" className="text-sm text-blue-600 underline dark:text-blue-400">
            ← Inventory
          </Link>
          <h1 className="text-xl font-semibold">{getItemDisplayLabel(item)}</h1>
        </div>
        <DeleteItemButton itemId={item.id} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-600">Photos</h2>
        <PhotoGallery photos={item.photos} />
        <PhotoUploadForm itemId={item.id} />
      </section>

      <AiSuggestions itemId={item.id} photoCount={item.photos.length} latestAnalysis={latestAnalysis} />

      <PhotoCoach
        itemId={item.id}
        photoCount={item.photos.length}
        latestAnalysis={latestPhotoCoachAnalysis}
      />

      <MarketResearch
        itemId={item.id}
        item={{ brand: item.brand, category: item.category }}
        comparables={comparables}
      />

      <SellTiming
        itemId={item.id}
        item={{ brand: item.brand, category: item.category }}
        latestAnalysis={latestSellTimingAnalysis}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-600">Details</h2>
        <ItemForm
          mode="edit"
          itemId={item.id}
          defaultValues={{
            brand: item.brand,
            color: item.color,
            category: item.category,
            size: item.size,
            condition: item.condition,
            notableDetails: item.notableDetails,
            acquisitionCostCents: item.acquisitionCostCents,
          }}
        />
      </section>
    </main>
  );
}
