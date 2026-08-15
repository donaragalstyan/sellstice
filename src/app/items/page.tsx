import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getItemDisplayLabel, ITEM_STATUS_LABELS } from "@/lib/item-display";

export default async function ItemsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const items = await prisma.item.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { photos: { orderBy: { order: "asc" }, take: 1 } },
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-blue-600 underline dark:text-blue-400">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold">Inventory</h1>
        </div>
        <Link
          href="/items/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add item
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No items yet. Add the first thing you&apos;re thinking of selling —
          you don&apos;t have to decide whether to list it yet.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/items/${item.id}`}
                className="flex flex-col gap-2 rounded-lg border border-gray-300 p-3 hover:bg-gray-50 dark:hover:bg-white/5"
              >
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-white/10">
                  {item.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photos[0].url}
                      alt={getItemDisplayLabel(item)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-gray-400">No photo</span>
                  )}
                </div>
                <span className="text-sm font-medium">{getItemDisplayLabel(item)}</span>
                <span className="text-xs text-gray-500">{ITEM_STATUS_LABELS[item.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
