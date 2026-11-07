import { describe, expect, it } from "vitest";
import { canonicalJson, deriveSeed, hashString, mulberry32, rngFrom, sampleDistinct, sha256Bytes, sha256Text, shuffle } from "./prng.ts";

describe("prng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(mulberry32(43)()).not.toBe(seqA[0]);
    for (const x of seqA) expect(x >= 0 && x < 1).toBe(true);
  });
  it("derives stable seeds from parts", () => {
    expect(deriveSeed("a", 1, 2n)).toBe(deriveSeed("a", 1, 2n));
    expect(deriveSeed("a", 1)).not.toBe(deriveSeed("a", 2));
    expect(hashString("x")).toBe(hashString("x"));
    expect(rngFrom("s")()).toBe(rngFrom("s")());
  });
  it("shuffles as a permutation, deterministically", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const s1 = shuffle(items, mulberry32(7));
    expect([...s1].sort()).toEqual(items);
    expect(s1).toEqual(shuffle(items, mulberry32(7)));
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sampleDistinct(items, 3, mulberry32(1))).toHaveLength(3);
  });
});

describe("canonicalJson", () => {
  it("sorts keys, drops undefined and handles nesting", () => {
    expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 2 }] })).toBe('{"a":[{"c":2}],"b":1}');
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("x")).toBe('"x"');
  });
});

describe("sha256", () => {
  it("matches known vectors", () => {
    expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const long = "a".repeat(1000);
    expect(sha256Bytes(new TextEncoder().encode(long))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });
});
