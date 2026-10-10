import { Suspense } from "react";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-2 font-mono text-sm tracking-widest text-accent">
          <span className="inline-block size-2 rounded-full bg-accent" /> AIRPOOL
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Welcome aboard</h1>
        <p className="mt-2 text-muted">Sign in to find people to share your airport cab with.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
