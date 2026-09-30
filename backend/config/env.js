export const parseHttpUrl = (value, name) => {
  if (!value) throw new Error(`${name} is not configured`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.origin === "null") {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  return url;
};

export const getFrontendUrl = () =>
  parseHttpUrl(process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.Client_URI,
    "FRONTEND_URL").origin;

export const validateEnvironment = () => {
  const required = ["MONGODB_URI", "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"];
  if (process.env.NODE_ENV === "production") {
    required.push("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "EMAIL_HOST", "EMAIL_PORT",
      "EMAIL_USER", "EMAIL_PASS", "CLOUD_NAME", "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_KEY_SECRET");
  }
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  parseHttpUrl(process.env.CLIENT_URL || process.env.Client_URI, "CLIENT_URL");
  getFrontendUrl();
};
