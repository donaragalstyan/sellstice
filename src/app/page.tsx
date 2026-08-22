import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="animate-in flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center sm:p-8">
      <div className="sun-track" aria-hidden="true">
        <div className="sun" />
      </div>
      <h1 className="text-gradient text-4xl font-semibold tracking-tight sm:text-5xl">
        Sellstice
      </h1>
      <p className="max-w-md text-balance" style={{ color: "var(--color-muted)" }}>
        A brighter way to resell
      </p>
      <div className="flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
        {session ? (
          <Link href="/dashboard" className="btn btn-primary">
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link href="/signup" className="btn btn-primary">
              Get started
            </Link>
            <Link href="/login" className="btn btn-secondary">
              Log in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
