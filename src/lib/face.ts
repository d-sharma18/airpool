"use client";

// face-api.js (maintained @vladmandic build) running fully in the browser.
// Model weights load from jsDelivr, so there is nothing to host.

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

type FaceApi = typeof import("@vladmandic/face-api");
let ready: Promise<FaceApi> | null = null;

export function loadFaceApi() {
  ready ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    return faceapi;
  })();
  return ready;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/** Aadhaar photos are tiny (~160px), so upscale before detection. */
function upscale(img: HTMLImageElement, minSide = 320) {
  const k = Math.max(1, minSide / Math.min(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function descriptor(faceapi: FaceApi, src: string) {
  const input = upscale(await loadImage(src));
  const ssd = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (ssd) return ssd.descriptor;
  const tiny = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return tiny?.descriptor ?? null;
}

export interface FaceMatchResult {
  /** 1 − euclidean distance. ≥ 0.45 (distance ≤ 0.55) is treated as the same person. */
  score: number;
  match: boolean;
}

export async function compareFaces(aadhaarPhoto: string, selfie: string): Promise<FaceMatchResult> {
  const faceapi = await loadFaceApi();
  const [a, b] = await Promise.all([descriptor(faceapi, aadhaarPhoto), descriptor(faceapi, selfie)]);
  if (!a) throw new Error("Couldn't find a face in the Aadhaar photo.");
  if (!b) throw new Error("Couldn't find your face in the selfie. Face the camera in good light.");
  const score = 1 - faceapi.euclideanDistance(a, b);
  return { score, match: score >= 0.45 };
}
