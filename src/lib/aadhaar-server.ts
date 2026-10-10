import "server-only";
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

export const MAX_EKYC_AGE_DAYS = 30;

export interface VerifiedAadhaar {
  signatureOk: boolean;
  referenceId: string;
  last4: string;
  name: string;
  dob: string;
  birthYear: number;
  gender: "M" | "F" | "T";
  mobileHash: string;
  generatedAt: Date;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function certPem() {
  const pem = process.env.UIDAI_CERT_PEM?.replace(/\\n/g, "\n").trim();
  if (!pem) return null;
  return pem.includes("BEGIN CERTIFICATE") ? pem : `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----`;
}

/**
 * Verify UIDAI's XML digital signature and read identity fields from the *signed* content
 * (not the raw upload), which defeats signature-wrapping tricks.
 */
export function verifyOfflineXml(xml: string): VerifiedAadhaar {
  const pem = certPem();
  let signedXml = xml;
  let signatureOk = false;

  if (pem) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const sigNode = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0];
    if (!sigNode) throw new Error("The eKYC file has no UIDAI signature.");
    const sig = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
    sig.loadSignature(sigNode as unknown as Node);
    if (!sig.checkSignature(xml)) throw new Error("UIDAI signature check failed. The file may have been edited.");
    const refs = sig.getSignedReferences();
    if (!refs.length) throw new Error("UIDAI signature covers no content.");
    signedXml = refs[0];
    signatureOk = true;
  } else if (process.env.ALLOW_UNSIGNED_AADHAAR !== "true") {
    throw new Error("Server is missing UIDAI_CERT_PEM, so Aadhaar files can't be verified yet.");
  }

  const doc = new DOMParser().parseFromString(signedXml, "text/xml");
  const root = doc.getElementsByTagName("OfflinePaperlessKyc")[0];
  const poi = doc.getElementsByTagName("Poi")[0];
  if (!root || !poi) throw new Error("Not an Aadhaar offline eKYC XML.");

  const referenceId = root.getAttribute("referenceId") ?? "";
  const dob = poi.getAttribute("dob") ?? "";
  const gender = (poi.getAttribute("gender") ?? "").toUpperCase() as VerifiedAadhaar["gender"];
  const birthYear = Number(dob.split("-").pop());
  const t = referenceId.slice(4);
  const generatedAt = new Date(
    `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+05:30`,
  );

  if (!/^\d{4}/.test(referenceId) || Number.isNaN(generatedAt.getTime())) throw new Error("Unreadable reference ID.");
  if (!["M", "F", "T"].includes(gender)) throw new Error("Unreadable gender.");
  if (!birthYear) throw new Error("Unreadable date of birth.");

  return {
    signatureOk,
    referenceId,
    last4: referenceId.slice(0, 4),
    name: (poi.getAttribute("name") ?? "").trim(),
    dob,
    birthYear,
    gender,
    mobileHash: (poi.getAttribute("m") ?? "").toLowerCase(),
    generatedAt,
  };
}

/** UIDAI scheme: SHA-256(mobile + shareCode), re-hashed N times where N = last Aadhaar digit (min 1). */
export function mobileMatches(a: VerifiedAadhaar, mobile10: string, shareCode: string) {
  if (!a.mobileHash) return false;
  const rounds = Math.max(1, Number(a.last4.at(-1)));
  let h = mobile10 + shareCode;
  for (let i = 0; i < rounds; i++) h = sha256(h);
  return h === a.mobileHash;
}

/** Stable per-person hash so one Aadhaar can back only one account. */
export function identityHash(a: VerifiedAadhaar) {
  const pepper = process.env.AADHAAR_HASH_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const name = a.name.toLowerCase().replace(/[^a-z]/g, "");
  return sha256(`${pepper}|${a.last4}|${a.dob}|${a.gender}|${name}`);
}

export function ageOn(dob: string, now = new Date()) {
  const [d, m, y] = dob.split("-").map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}
