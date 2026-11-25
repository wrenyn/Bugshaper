import { HttpError, json } from "../helpers/http.mjs";

function isUniqueViolation(error) {
  return error?.code === "23505"
    || error?.code?.startsWith("ERR_SQLITE_CONSTRAINT")
    || error?.errcode === 2067;
}

export function handlePlatformError(error, res, requestId) {
  const status = error instanceof HttpError
    ? error.status
    : isUniqueViolation(error) ? 409 : 500;
  if (status === 500) {
    console.error(JSON.stringify({ level: "error", requestId, message: "Platform request failed", code: error.code || error.name }));
  }
  if (!res.headersSent && !res.destroyed) {
    json(res, status, {
      error: status === 500
        ? "Something went wrong. Please try again."
        : status === 409 && !(error instanceof HttpError)
          ? "A record with these details already exists."
          : error.message,
      requestId,
    });
  }
}
