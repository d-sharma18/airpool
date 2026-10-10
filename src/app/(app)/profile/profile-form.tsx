"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorNote, Input, Label, Spinner } from "@/components/ui";
import { UPI_ID_RE } from "@/lib/deeplinks";
import { createClient } from "@/lib/supabase/client";

export default function ProfileForm({
  userId,
  upi: initialUpi,
  phone: initialPhone,
  phoneVerified,
}: {
  userId: string;
  upi: string;
  phone: string;
  phoneVerified: boolean;
}) {
  const router = useRouter();
  const [upi, setUpi] = useState(initialUpi);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    if (upi && !UPI_ID_RE.test(upi)) return setError("UPI ID looks wrong. It should look like name@okhdfcbank.");
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (phone && !/^[6-9]\d{9}$/.test(digits)) return setError("Enter a valid 10-digit mobile number.");

    setBusy(true);
    const supabase = createClient();
    const r1 = await supabase.from("profiles").update({ upi_id: upi || null }).eq("id", userId);
    const r2 =
      digits !== initialPhone
        ? await supabase.from("profile_private").update({ phone: digits || null }).eq("user_id", userId)
        : { error: null };
    setBusy(false);
    if (r1.error || r2.error) return setError((r1.error ?? r2.error)!.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={save} className="grid gap-4">
        <label>
          <Label hint="Riders pay you here">UPI ID</Label>
          <Input value={upi} onChange={(e) => setUpi(e.target.value.trim())} placeholder="yourname@okaxis" autoCapitalize="none" />
        </label>
        <label>
          <Label hint={phoneVerified ? "✓ matches Aadhaar" : "Shared only in locked groups"}>Mobile number</Label>
          <Input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        {phoneVerified && <p className="-mt-2 text-xs text-muted">Changing your number removes the Aadhaar tick.</p>}
        <ErrorNote>{error}</ErrorNote>
        {saved && <p className="text-sm text-ok">Saved</p>}
        <Button type="submit" full disabled={busy}>
          {busy && <Spinner />} Save
        </Button>
      </form>
    </Card>
  );
}
