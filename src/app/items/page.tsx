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
    <main className="animate-in page max-w-3xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/dashboard" className="link text-sm">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-semibold">Inventory</h1>
        </div>
        <Link href="/items/new" className="btn btn-primary self-start">
          Add item
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="card card-dashed text-sm" style={{ color: "var(--color-muted)" }}>
          No items yet. Add the first thing you&apos;re thinking of selling —
          you don&apos;t have to decide whether to list it yet.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/items/${item.id}`} className="card interactive gap-2 p-3">
                <div
                  className="flex aspect-square items-center justify-center overflow-hidden rounded-md"
                  style={{ background: "var(--color-surface-2)" }}
                >
                  {item.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/photos/${item.photos[0].id}`}
                      alt={getItemDisplayLabel(item)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>No photo</span>
                  )}
                </div>
                <span className="text-sm font-medium">{getItemDisplayLabel(item)}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {ITEM_STATUS_LABELS[item.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
