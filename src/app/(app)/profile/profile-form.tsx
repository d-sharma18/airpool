"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toaster";
import { Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { normalizePhone, validateFullName, validatePhone, validateUpi } from "@/lib/validation";

export default function ProfileForm(props: {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  upi: string;
  phoneLocked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fullName, setFullName] = useState(props.fullName);
  const [phone, setPhone] = useState(props.phone);
  const [upi, setUpi] = useState(props.upi);
  const [errs, setErrs] = useState<{ fullName?: string | null; phone?: string | null; upi?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = {
      fullName: validateFullName(fullName),
      phone: props.phoneLocked ? null : validatePhone(phone),
      upi: validateUpi(upi),
    };
    setErrs(found);
    if (Object.values(found).some(Boolean)) return;

    setBusy(true);
    setError("");
    const update: Record<string, string> = { full_name: fullName.trim(), upi_id: upi.trim() };
    if (!props.phoneLocked) update.phone = normalizePhone(phone);
    const { error } = await createClient().from("profiles").update(update).eq("id", props.userId);
    setBusy(false);
    if (error) return setError(error.message);
    toast("Profile saved", "success");
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={save} noValidate className="grid gap-4">
        <Field id="email" label="Email">
          <Input id="email" value={props.email} disabled className="opacity-60" />
        </Field>
        <Field id="fullName" label="Full name" error={errs.fullName}>
          <Input id="fullName" autoComplete="name" value={fullName} invalid={!!errs.fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field
          id="phone"
          label="Mobile number"
          hint={props.phoneLocked ? "Locked to your Aadhaar" : "Must be Aadhaar-linked"}
          error={errs.phone}
        >
          <Input
            id="phone"
            type="tel"
            inputMode="numeric"
            value={phone}
            disabled={props.phoneLocked}
            className={props.phoneLocked ? "opacity-60" : undefined}
            invalid={!!errs.phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field id="upi" label="UPI ID" hint="Co-riders pay you here" error={errs.upi}>
          <Input id="upi" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@bank" value={upi} invalid={!!errs.upi} onChange={(e) => setUpi(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" full disabled={busy}>
          {busy && <Spinner />} Save
        </Button>
      </form>
    </Card>
  );
}
