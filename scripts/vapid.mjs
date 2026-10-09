import webpush from "web-push";
import { writeFile } from "node:fs/promises";
const keys = webpush.generateVAPIDKeys();
// Write to an ignored local file; never print the private key.
await writeFile(
  ".env.vapid.local",
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`,
  { mode: 0o600 },
);
console.log(
  "Keys saved to ignored .env.vapid.local. Copy them privately to .env.local and Vercel.",
);
