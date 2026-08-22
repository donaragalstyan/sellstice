"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction, type SignupState } from "./actions";

const initialState: SignupState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <main className="animate-in mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 sm:p-8">
      <div>
        <span className="eyebrow">Get started</span>
        <h1 className="text-2xl font-semibold">Create your account</h1>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <label className="field">
          Name (optional)
          <input name="name" type="text" autoComplete="name" className="input" />
        </label>
        <label className="field">
          Email
          <input name="email" type="email" required autoComplete="email" className="input" />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
          />
        </label>
        {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Already have an account? <Link href="/login" className="link font-medium">Log in</Link>
      </p>
    </main>
  );
}
