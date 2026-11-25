import { extractBundle, makeBundle } from "./bundle.js";

const formats = {
  screenshot: { type: "image/png", max: 10_000_000, signature: [137, 80, 78, 71, 13, 10, 26, 10] },
  video: { type: "video/webm", max: 20_000_000, signature: [26, 69, 223, 163] },
};
export const maxBundleBytes = 41_000_000;

async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function check(bytes, format) {
  if (bytes.length < format.signature.length || bytes.length > format.max ||
      !format.signature.every((byte, index) => bytes[index] === byte)) throw new Error("Unsupported media format or size.");
}

function base64(bytes) {
  let result = "";
  // Each full chunk has a length divisible by three so only the final chunk can need padding.
  for (let index = 0; index < bytes.length; index += 12_288) {
    result += btoa(String.fromCharCode(...bytes.subarray(index, index + 12_288)));
  }
  return result;
}

export async function makeLocalBundle(report, selected) {
  const bundle = await makeBundle(report);
  const media = {};
  for (const name of new Set(selected)) {
    if (!Object.hasOwn(formats, name)) throw new Error("Unsupported attachment.");
    const format = formats[name];
    const blob = report[name];
    if (!(blob instanceof Blob) || blob.type !== format.type || blob.size > format.max) {
      throw new Error("The selected attachment is unavailable or too large.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    check(bytes, format);
    media[name] = { type: format.type, sha256: await hash(bytes), data: base64(bytes) };
  }
  if (Object.keys(media).length) bundle.media = media;
  return bundle;
}

export async function extractLocalBundle(bundle) {
  const report = await extractBundle(bundle);
  if (bundle.media === undefined) return report;
  if (!bundle.media || Array.isArray(bundle.media) || typeof bundle.media !== "object") {
    throw new Error("Invalid media manifest.");
  }
  for (const [name, entry] of Object.entries(bundle.media)) {
    if (!Object.hasOwn(formats, name)) throw new Error("Unsupported attachment.");
    const format = formats[name];
    if (!entry || entry.type !== format.type || typeof entry.sha256 !== "string" ||
        typeof entry.data !== "string" || entry.data.length > Math.ceil(format.max / 3) * 4) {
      throw new Error("Invalid attachment metadata.");
    }
    const bytes = Uint8Array.from(atob(entry.data), (value) => value.charCodeAt(0));
    check(bytes, format);
    if (await hash(bytes) !== entry.sha256) throw new Error("An attachment failed its integrity check.");
    report[name] = new Blob([bytes], { type: format.type });
  }
  return report;
}
