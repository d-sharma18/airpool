"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { normalizePhone, validateFullName, validatePhone, validateUpi } from "@/lib/validation";

export default function OnboardingForm(props: { userId: string; fullName: string; phone: string; upi: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(props.fullName);
  const [phone, setPhone] = useState(props.phone);
  const [upi, setUpi] = useState(props.upi);
  const [errs, setErrs] = useState<{ fullName?: string | null; phone?: string | null; upi?: string | null }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = { fullName: validateFullName(fullName), phone: validatePhone(phone), upi: validateUpi(upi) };
    setErrs(found);
    if (Object.values(found).some(Boolean)) return;

    setBusy(true);
    setError("");
    const { error } = await createClient()
      .from("profiles")
      .update({ full_name: fullName.trim(), phone: normalizePhone(phone), upi_id: upi.trim() })
      .eq("id", props.userId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    router.replace("/verify");
    router.refresh();
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="fullName" label="Full name" hint="As on your Aadhaar" error={errs.fullName}>
        <Input id="fullName" autoComplete="name" value={fullName} invalid={!!errs.fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field id="phone" label="Mobile number" error={errs.phone}>
        <div className="flex gap-2">
          <span className="grid h-12 place-items-center rounded-xl border border-line bg-surface-2 px-3 font-mono text-muted">+91</span>
          <Input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98XXXXXXXX" maxLength={14} value={phone} invalid={!!errs.phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </Field>
      <p className="-mt-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 text-sm">
        <span className="font-semibold text-accent">Use the number linked to your Aadhaar.</span>{" "}
        <span className="text-muted">We check it against your Aadhaar during verification, so any other number will fail.</span>
      </p>
      <Field id="upi" label="UPI ID" hint="Co-riders pay you here" error={errs.upi}>
        <Input id="upi" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@bank" value={upi} invalid={!!errs.upi} onChange={(e) => setUpi(e.target.value)} />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" full disabled={busy}>
        {busy && <Spinner />} Continue
      </Button>
    </form>
  );
}
