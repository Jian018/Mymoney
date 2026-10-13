import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function equalSecret(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function key() {
  const raw = Buffer.from(
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY ?? "",
    "base64",
  );
  if (raw.length !== 32)
    throw new Error(
      "Configure a 32-byte base64 GMAIL_TOKEN_ENCRYPTION_KEY on the server.",
    );
  return raw;
}
export function encrypt(value: unknown, context: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decrypt<T>(sealed: string, context: string): T {
  const [version, iv, tag, data, ...rest] = sealed.split(".");
  if (version !== "v1" || rest.length || !iv || !tag || !data)
    throw new Error("Stored Gmail authorization is invalid. Reconnect Gmail.");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  ) as T;
}
