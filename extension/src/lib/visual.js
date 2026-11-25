export function comparePixels(before, after, threshold = 24) {
  if (before.length !== after.length || before.length % 4 !== 0 ||
      !Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError("Use equal-sized RGBA images and a threshold from 0 to 255.");
  }
  const overlay = new Uint8ClampedArray(before.length);
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    const difference = Math.max(
      Math.abs(before[i] - after[i]), Math.abs(before[i + 1] - after[i + 1]),
      Math.abs(before[i + 2] - after[i + 2]), Math.abs(before[i + 3] - after[i + 3]),
    );
    if (difference > threshold) {
      changed++;
      overlay.set([255, 82, 110, 255], i);
    } else {
      overlay.set([before[i] / 3, before[i + 1] / 3, before[i + 2] / 3, 255], i);
    }
  }
  return { changed, pixels: before.length / 4, overlay };
}
