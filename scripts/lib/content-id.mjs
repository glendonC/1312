import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export const SHA256_PREFIX = "sha256:";

/** Hash a file without loading owned media into the JavaScript heap. */
export async function fingerprintFile(path) {
  const details = await stat(path);
  if (!details.isFile() || details.size <= 0) throw new Error(`${path} is not a non-empty regular file`);

  const digest = await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });

  return {
    algorithm: "sha256",
    digest,
    contentId: `${SHA256_PREFIX}${digest}`,
    bytes: details.size,
  };
}
