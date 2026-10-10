"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, ErrorNote, Input, Label, Spinner, cx } from "@/components/ui";
import { readOfflineEkyc, type AadhaarPreview } from "@/lib/aadhaar-client";
import { compareFaces, loadFaceApi, type FaceMatchResult } from "@/lib/face";
import { createClient } from "@/lib/supabase/client";

type Step = "file" | "selfie" | "phone";

export default function VerifyFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("file");
  const [aadhaar, setAadhaar] = useState<AadhaarPreview | null>(null);
  const [shareCode, setShareCode] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [match, setMatch] = useState<FaceMatchResult | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Warm up face models while the user hunts for their ZIP.
  useEffect(() => {
    loadFaceApi().catch(() => {});
  }, []);

  async function onFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem("zip") as HTMLInputElement).files?.[0];
    if (!file) return setError("Choose the ZIP file you downloaded from UIDAI.");
    setBusy(true);
    setError("");
    try {
      setAadhaar(await readOfflineEkyc(file, shareCode));
      setStep("selfie");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSelfie(dataUrl: string) {
    if (!aadhaar) return;
    setSelfie(dataUrl);
    setBusy(true);
    setError("");
    setMatch(null);
    try {
      const r = await compareFaces(aadhaar.photo, dataUrl);
      setMatch(r);
      if (!r.match) setError("That doesn't look like the Aadhaar photo. Try again facing the camera in good light.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!aadhaar || !selfie || !match?.match) return;
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Session expired. Sign in again.");
      const selfiePath = `${user.id}/selfie.jpg`;
      const blob = await (await fetch(selfie)).blob();
      const up = await supabase.storage.from("selfies").upload(selfiePath, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) throw new Error(up.error.message);

      const res = await fetch("/api/aadhaar/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xml: aadhaar.xml, shareCode, phone, faceScore: match.score, selfiePath }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Verification failed");
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-4">
      <ol className="grid grid-cols-3 gap-2 text-center text-xs">
        {(["file", "selfie", "phone"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={cx(
              "rounded-lg border py-2",
              step === s ? "border-accent text-accent" : "border-line text-muted",
            )}
          >
            {i + 1}. {s === "file" ? "eKYC file" : s === "selfie" ? "Selfie" : "Phone"}
          </li>
        ))}
      </ol>

      {step === "file" && (
        <Card>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Open{" "}
              <a className="text-accent underline" href="https://myaadhaar.uidai.gov.in/offline-ekyc" target="_blank" rel="noreferrer">
                myaadhaar.uidai.gov.in/offline-ekyc
              </a>
            </li>
            <li>Enter your Aadhaar number and OTP, and set a 4-digit share code</li>
            <li>Download the ZIP and pick it below</li>
          </ol>
          <form onSubmit={onFile} className="grid gap-4">
            <label>
              <Label>Offline eKYC ZIP</Label>
              <input
                name="zip"
                type="file"
                accept=".zip,application/zip"
                required
                className="block w-full text-sm text-muted file:mr-3 file:h-10 file:rounded-lg file:border-0 file:bg-surface-2 file:px-4 file:text-ink"
              />
            </label>
            <label>
              <Label>Share code</Label>
              <Input
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                value={shareCode}
                onChange={(e) => setShareCode(e.target.value.replace(/\D/g, ""))}
                placeholder="4 digits"
              />
            </label>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" full disabled={busy}>
              {busy && <Spinner />} Read file
            </Button>
          </form>
        </Card>
      )}

      {step === "selfie" && aadhaar && (
        <Card className="grid gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={aadhaar.photo} alt="Aadhaar photo" className="h-16 w-14 rounded-lg object-cover" />
            <div>
              <p className="font-semibold">{aadhaar.name}</p>
              <p className="text-sm text-muted">
                {aadhaar.gender === "F" ? "Female" : aadhaar.gender === "M" ? "Male" : "Transgender"} · XXXX XXXX{" "}
                {aadhaar.last4}
              </p>
            </div>
          </div>
          <SelfieCamera onCapture={onSelfie} disabled={busy} />
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Comparing faces on your device…
            </p>
          )}
          {match && (
            <div className="flex items-center justify-between">
              <Badge tone={match.match ? "ok" : "danger"}>
                {match.match ? "✓ Face matched" : "✗ No match"} · {Math.round(match.score * 100)}%
              </Badge>
              {match.match && <Button onClick={() => setStep("phone")}>Continue</Button>}
            </div>
          )}
          <ErrorNote>{error}</ErrorNote>
        </Card>
      )}

      {step === "phone" && (
        <Card>
          <form onSubmit={submit} className="grid gap-4">
            <label>
              <Label hint="Shared only inside locked groups">Mobile number</Label>
              <Input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
                placeholder="98XXXXXXXX"
              />
            </label>
            <p className="text-xs text-muted">
              If this is the number linked to your Aadhaar, your co-riders will see a &ldquo;matches Aadhaar&rdquo; tick next
              to it.
            </p>
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" full disabled={busy}>
              {busy && <Spinner />} Finish verification
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function SelfieCamera({ onCapture, disabled }: { onCapture: (dataUrl: string) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  async function start() {
    setErr("");
    setShot(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      setStream(s);
      requestAnimationFrame(() => {
        if (video.current) video.current.srcObject = s;
      });
    } catch {
      setErr("Camera blocked. Allow camera access in your browser settings and try again.");
    }
  }

  function capture() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    const url = c.toDataURL("image/jpeg", 0.85);
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShot(url);
    onCapture(url);
  }

  return (
    <div className="grid gap-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-surface-2">
        {stream && <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!stream && shot && <img src={shot} alt="Your selfie" className="size-full object-cover" />}
        {!stream && !shot && (
          <div className="grid size-full place-items-center p-6 text-center text-sm text-muted">
            Take a live selfie. We match it against your Aadhaar photo on this device.
          </div>
        )}
        {stream && <div className="pointer-events-none absolute inset-[15%_18%] rounded-[50%] border-2 border-accent/70" />}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {stream ? (
        <Button full onClick={capture}>
          Capture
        </Button>
      ) : (
        <Button full variant={shot ? "ghost" : "primary"} onClick={start} disabled={disabled}>
          {shot ? "Retake selfie" : "Open camera"}
        </Button>
      )}
    </div>
  );
}
