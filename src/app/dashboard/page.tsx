import { auth, signOut } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="text-gray-600">
        Signed in as <span className="font-medium">{session?.user?.email}</span>.
      </p>
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500">
        Goals, inventory, and listings will show up here in later phases.
      </div>
    </main>
  );
}
