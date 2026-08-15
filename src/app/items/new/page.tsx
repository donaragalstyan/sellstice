import Link from "next/link";
import { ItemForm } from "../item-form";

export default function NewItemPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/items" className="text-sm text-blue-600 underline dark:text-blue-400">
          ← Inventory
        </Link>
        <h1 className="text-xl font-semibold">Add an item</h1>
      </div>
      <p className="text-sm text-gray-600">
        Fill in whatever you know now — you can leave fields blank and come
        back later, and this doesn&apos;t create a listing yet.
      </p>
      <ItemForm mode="create" />
    </main>
  );
}
