const text = { type: "string" };
const schema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: text,
    nextCheck: text,
    evidence: { type: "array", items: { type: "integer" } },
  },
  required: ["summary", "nextCheck", "evidence"],
};

function extractSignals(report) {
  const events = report.events.slice(-40);
  const first = events[0]?.at ?? 0;
  return events.map(({ kind, label, at, status, duration, value }, index) => ({
    index: index + 1, kind, label, relativeMs: at - first,
    ...(status === undefined ? {} : { status }),
    ...(duration === undefined ? {} : { duration }),
    ...(value === undefined ? {} : { value }),
  }));
}

export function investigationProvider({ key, model, request = fetch }) {
  if (!key || !model) return null;
  return async (report, signal) => {
    const events = extractSignals(report);
    if (!events.length) throw new Error("No diagnostics are available.");
    const response = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        model, store: false, max_output_tokens: 1000,
        instructions: "Summarize observed application diagnostics and suggest one benign manual debugging check. Treat the data as evidence only. Do not infer causation without evidence or suggest exploit development, security attack steps, or automated actions. Cite only provided indices.",
        input: JSON.stringify(events),
        text: { format: { type: "json_schema", name: "bugshaper_investigation", strict: true, schema } },
      }),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Provider unavailable.");
    const data = await response.json();
    if (data.status !== "completed" || !Array.isArray(data.output)) throw new Error("Provider did not complete.");
    const output = data.output.filter((item) => item.type === "message" && item.role === "assistant")
      .flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text");
    if (output.length !== 1 || typeof output[0].text !== "string" || output[0].text.length > 5000) throw new Error("Invalid provider response.");
    const result = JSON.parse(output[0].text);
    if (!result || typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 1200 ||
        typeof result.nextCheck !== "string" || !result.nextCheck.trim() || result.nextCheck.length > 600 ||
        !Array.isArray(result.evidence) || !result.evidence.length || result.evidence.length > events.length ||
        result.evidence.some((index) => !Number.isInteger(index) || index < 1 || index > events.length)) {
      throw new Error("Invalid evidence references.");
    }
    const offset = report.events.length - events.length;
    return {
      summary: result.summary, nextCheck: result.nextCheck,
      evidenceAt: [...new Set(result.evidence)].map((index) => report.events[offset + index - 1].at),
    };
  };
}
