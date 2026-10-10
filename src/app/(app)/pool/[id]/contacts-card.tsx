"use client";

import { useToast } from "@/components/toaster";
import { Badge, Button, Card, buttonClass } from "@/components/ui";
import { formatPhone, whatsappLink } from "@/lib/share";
import type { Contact } from "./pool-view";

/**
 * Shown only once the group is locked. Phone numbers come from get_pool_contacts(),
 * which returns nothing before lock.
 */
export default function ContactsCard({
  me,
  contacts,
  message,
}: {
  me: string;
  contacts: Contact[];
  /** Full group details for WhatsApp / family. */
  message: string;
}) {
  const toast = useToast();

  async function shareWithFamily() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "My Airpool ride", text: message });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      toast("Ride details copied. Paste them to your family", "success");
    } catch {
      window.open(whatsappLink(message), "_blank", "noopener");
    }
  }

  return (
    <Card className="grid grid-cols-1 gap-3 border-ok/30">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Your co-riders</h2>
        <Badge tone="ok">🔓 Locked</Badge>
      </div>

      {contacts.map((c) => (
        <div key={c.user_id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {c.name ?? "Rider"}
              {c.user_id === me && <span className="ml-1 text-xs text-muted">(you)</span>}
            </p>
            <p className="font-mono text-sm text-muted">
              {c.phone ? formatPhone(c.phone) : "No number"}
              {c.phone_verified && <span className="ml-1.5 font-sans text-xs text-ok">✓ Aadhaar-linked</span>}
            </p>
          </div>
          {c.phone && c.user_id !== me && (
            <a href={`tel:+91${c.phone}`} className={`${buttonClass("ghost")} shrink-0 px-3`} aria-label={`Call ${c.name}`}>
              📞 Tap to call
            </a>
          )}
        </div>
      ))}

      <div className="grid grid-cols-1 gap-2">
        <a href={whatsappLink(message)} target="_blank" rel="noreferrer" className={buttonClass("ghost")}>
          Send on WhatsApp
        </a>
        <Button variant="ghost" onClick={shareWithFamily}>
          Share with family
        </Button>
      </div>
      <p className="text-xs text-muted">
        Sends everyone&apos;s name, phone, flights, route, car and meeting point.
      </p>
    </Card>
  );
}
