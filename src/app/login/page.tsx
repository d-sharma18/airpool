import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import LoginForm from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Log in to find people to share your airport cab with.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
