import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmbedRequest, EmbedResult, JsonRequest, LlmClient, LlmResult } from "./client.ts";
import { cacheKey } from "./service.ts";

// Wraps a real client and saves each answer as a fixture. Manual use only: RECORD_FIXTURES=1.
export class RecordingClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly dir: string,
  ) {
    if (process.env["RECORD_FIXTURES"] !== "1") {
      throw new Error("RecordingClient only runs with RECORD_FIXTURES=1 (never in CI)");
    }
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<LlmResult<T>> {
    const res = await this.inner.generateJson(req);
    const dir = join(this.dir, req.task);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${cacheKey(res.model, req).slice(0, 16)}.json`), JSON.stringify(res.data, null, 2));
    return res;
  }

  embedImage(req: EmbedRequest): Promise<EmbedResult> {
    return this.inner.embedImage(req);
  }
}
