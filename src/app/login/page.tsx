import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="animate-in mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6 sm:p-8">
      <div>
        <span className="eyebrow">Welcome back</span>
        <h1 className="text-2xl font-semibold">Log in</h1>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
