import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import SignupForm from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" subtitle="Takes a minute. You'll verify with Aadhaar right after.">
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
