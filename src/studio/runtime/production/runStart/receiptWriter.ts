import { writeFile } from "node:fs/promises";

import { identifyFile } from "../artifactStore.ts";
import type { ContentIdentity } from "../model.ts";
import { assertRuntimeStartRecord } from "../runStartValidation.ts";

export async function writeRuntimeStartReceipt(path: string, startValue: unknown): Promise<ContentIdentity> {
  assertRuntimeStartRecord(startValue);
  await writeFile(path, `${JSON.stringify(startValue, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return identifyFile(path);
}
