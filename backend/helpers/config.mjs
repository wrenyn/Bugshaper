export { plans } from "./plans.js";

export function platformConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const address = new URL(env.BUGSHAPER_ORIGIN || "http://localhost:4318");
  if (!["http:", "https:"].includes(address.protocol) || address.username || address.password || address.pathname !== "/" || address.search || address.hash) throw new Error("BUGSHAPER_ORIGIN must be a plain HTTP(S) origin without a path or credentials.");
  const origin = address.origin;
  if (production && !origin.startsWith("https://")) throw new Error("Production requires an HTTPS BUGSHAPER_ORIGIN.");
  if (production && env.BUGSHAPER_DEMO === "true") throw new Error("Demo login is forbidden in production.");
  if (production && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) throw new Error("Production requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  const billingValues = [env.DODO_PAYMENTS_API_KEY, env.DODO_PAYMENTS_WEBHOOK_KEY, env.DODO_PRODUCT_PRO, env.DODO_PRODUCT_BUSINESS];
  if (billingValues.some(Boolean) && !billingValues.every(Boolean)) throw new Error("Configure all Dodo billing credentials and product IDs together, or leave all unset.");
  if (env.DODO_PRODUCT_PRO && env.DODO_PRODUCT_PRO === env.DODO_PRODUCT_BUSINESS) throw new Error("Dodo Pro and Business products must be distinct.");
  const dodoEnvironment = env.DODO_PAYMENTS_ENVIRONMENT || "test_mode";
  if (!["test_mode", "live_mode"].includes(dodoEnvironment)) throw new Error("Invalid DODO_PAYMENTS_ENVIRONMENT.");
  if (production && billingValues.every(Boolean) && dodoEnvironment !== "live_mode") throw new Error("Production billing requires DODO_PAYMENTS_ENVIRONMENT=live_mode.");
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.BUGSHAPER_EMAIL_FROM)) throw new Error("Configure RESEND_API_KEY and BUGSHAPER_EMAIL_FROM together.");
  if (env.RESEND_API_KEY && !env.BUGSHAPER_DATA_KEY) throw new Error("Invitation email delivery requires a stable BUGSHAPER_DATA_KEY to encrypt queued links.");
  if (env.BUGSHAPER_DATA_KEY && (!/^[A-Za-z0-9+/]{43}=$/.test(env.BUGSHAPER_DATA_KEY) || Buffer.from(env.BUGSHAPER_DATA_KEY, "base64").length !== 32)) throw new Error("BUGSHAPER_DATA_KEY must be a base64-encoded 32-byte key.");
  const mediaDir = (env.BUGSHAPER_MEDIA_DIR || "").trim();
  const s3Values = [env.BUGSHAPER_S3_BUCKET, env.BUGSHAPER_S3_ACCESS_KEY, env.BUGSHAPER_S3_SECRET_KEY];
  if (s3Values.some(Boolean) && !s3Values.every(Boolean)) throw new Error("Configure BUGSHAPER_S3_BUCKET, BUGSHAPER_S3_ACCESS_KEY, and BUGSHAPER_S3_SECRET_KEY together.");
  return {
    origin, production, demo: !production && env.BUGSHAPER_DEMO === "true",
    trustProxy: env.BUGSHAPER_TRUST_PROXY === "1" || env.BUGSHAPER_TRUST_PROXY === "true",
    mediaDir,
    s3: {
      bucket: env.BUGSHAPER_S3_BUCKET || "",
      region: env.BUGSHAPER_S3_REGION || "us-east-1",
      accessKey: env.BUGSHAPER_S3_ACCESS_KEY || "",
      secretKey: env.BUGSHAPER_S3_SECRET_KEY || "",
      endpoint: env.BUGSHAPER_S3_ENDPOINT || "",
    },
    googleClientId: env.GOOGLE_CLIENT_ID, googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    dodoKey: env.DODO_PAYMENTS_API_KEY, dodoWebhookKey: env.DODO_PAYMENTS_WEBHOOK_KEY,
    dodoEnvironment, dodoBase: dodoEnvironment === "live_mode" ? "https://live.dodopayments.com" : "https://test.dodopayments.com",
    products: { pro: env.DODO_PRODUCT_PRO, business: env.DODO_PRODUCT_BUSINESS },
    resendKey: env.RESEND_API_KEY, emailFrom: env.BUGSHAPER_EMAIL_FROM,
    dataKey: env.BUGSHAPER_DATA_KEY,
  };
}
