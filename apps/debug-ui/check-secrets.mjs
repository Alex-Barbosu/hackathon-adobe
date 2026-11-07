// Build-time guard: the browser bundle must never contain service-role material.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const bad = walk("dist").filter((f) => /service_role|SERVICE_ROLE/.test(readFileSync(f, "utf8")));
if (bad.length > 0) {
  console.error(`Secret marker found in: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("bundle check ok");
