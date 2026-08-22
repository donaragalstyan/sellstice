import Link from "next/link";
import { ItemForm } from "../item-form";

export default function NewItemPage() {
  return (
    <main className="animate-in mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <Link href="/items" className="link text-sm">
          ← Inventory
        </Link>
        <h1 className="text-2xl font-semibold">Add an item</h1>
      </div>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Fill in whatever you know now — you can leave fields blank and come
        back later, and this doesn&apos;t create a listing yet.
      </p>
      <ItemForm mode="create" />
    </main>
  );
}
