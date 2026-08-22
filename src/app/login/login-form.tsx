"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
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
            autoComplete="current-password"
            className="input"
          />
        </label>
        {state.error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{state.error}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Don&apos;t have an account? <Link href="/signup" className="link font-medium">Sign up</Link>
      </p>
    </>
  );
}
