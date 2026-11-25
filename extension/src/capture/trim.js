/** Apply in/out points to a video Blob by re-recording a sliced playback window (WebM). */
export async function trimVideoBlob(blob, { startMs = 0, endMs } = {}) {
  if (!(blob instanceof Blob) || blob.type !== "video/webm") throw new Error("A WebM recording is required.");
  const start = Math.max(0, Number(startMs) || 0);
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await video.play().catch(() => {});
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Recording metadata could not be read."));
    });
    const durationMs = (video.duration || 0) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Recording duration is unavailable.");
    const finish = Math.min(durationMs, endMs == null || endMs <= 0 ? durationMs : Number(endMs));
    if (finish - start < 250) throw new Error("Trimmed clip must be at least 0.25 seconds.");
    video.pause();
    video.currentTime = start / 1000;
    await new Promise((resolve) => { video.onseeked = resolve; });

    const stream = video.captureStream();
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = () => reject(new Error("Trim recording failed."));
    });
    recorder.start(200);
    await video.play();
    await new Promise((resolve) => {
      const tick = () => {
        if (video.currentTime * 1000 >= finish || video.ended) {
          video.pause();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
    recorder.stop();
    for (const track of stream.getTracks()) track.stop();
    await stopped;
    if (!chunks.length) throw new Error("Trim produced no video.");
    return new Blob(chunks, { type: "video/webm" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
