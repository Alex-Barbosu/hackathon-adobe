import { describe, expect, it } from "vitest";
import { parseQuotas } from "./env.ts";

describe("parseQuotas", () => {
  it("parses QUOTA_<model>_<RPM|RPD> entries", () => {
    const q = parseQuotas({
      "QUOTA_gemini-3.5-flash-lite_RPM": "10",
      "QUOTA_gemini-3.5-flash-lite_RPD": "500",
    });
    expect(q).toEqual({ "gemini-3.5-flash-lite": { rpm: 10, rpd: 500 } });
  });
  it("prefers QUOTAS_JSON", () => {
    const q = parseQuotas({ QUOTAS_JSON: '{"m":{"rpm":1,"rpd":2}}', QUOTA_x_RPM: "9" });
    expect(q).toEqual({ m: { rpm: 1, rpd: 2 } });
  });
  it("fails fast when only one of rpm/rpd is given", () => {
    expect(() => parseQuotas({ QUOTA_m_RPM: "10" })).toThrow();
  });
});
