"use client";

// Runs entirely in the browser: the encrypted ZIP and the share code never leave the device.
// Only the signed XML is sent to our server for signature verification.

export interface AadhaarPreview {
  xml: string;
  referenceId: string;
  last4: string;
  name: string;
  dob: string;
  gender: "M" | "F" | "T";
  /** JPEG data URL of the photo inside the XML. */
  photo: string;
  generatedAt: Date;
}

export async function readOfflineEkyc(file: File, shareCode: string): Promise<AadhaarPreview> {
  const { ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(file), { password: shareCode });
  let xml = "";
  try {
    const entries = await reader.getEntries();
    const entry = entries.find((e) => e.filename.toLowerCase().endsWith(".xml") && !e.directory);
    if (!entry || entry.directory) throw new Error("No XML found inside the ZIP. Is this the UIDAI offline eKYC file?");
    xml = await entry.getData(new TextWriter());
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/password/i.test(msg)) throw new Error("Wrong share code. Use the 4-digit code you set while downloading.");
    throw e;
  } finally {
    await reader.close();
  }
  return parseOfflineXml(xml);
}

export function parseOfflineXml(xml: string): AadhaarPreview {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.querySelector("OfflinePaperlessKyc");
  const poi = doc.querySelector("Poi");
  const pht = doc.querySelector("Pht");
  if (!root || !poi || !pht) throw new Error("This doesn't look like an Aadhaar offline eKYC XML.");
  const referenceId = root.getAttribute("referenceId") ?? "";
  const gender = (poi.getAttribute("gender") ?? "").toUpperCase();
  if (!["M", "F", "T"].includes(gender)) throw new Error("Could not read gender from the eKYC file.");
  return {
    xml,
    referenceId,
    last4: referenceId.slice(0, 4),
    name: poi.getAttribute("name") ?? "",
    dob: poi.getAttribute("dob") ?? "",
    gender: gender as AadhaarPreview["gender"],
    photo: `data:image/jpeg;base64,${(pht.textContent ?? "").replace(/\s/g, "")}`,
    generatedAt: referenceTimestamp(referenceId),
  };
}

/** referenceId = last 4 Aadhaar digits + YYYYMMDDHHMMSSmmm (IST). */
export function referenceTimestamp(referenceId: string) {
  const t = referenceId.slice(4);
  const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+05:30`;
  return new Date(iso);
}
