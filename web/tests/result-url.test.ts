/**
 * Result URL and reload (R7.4): only a public sample's ID goes in the URL.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSampleId, resultHref } from "@/src/ui/result-url";

describe("parseSampleId", () => {
  it("accepts a sample file ID", () => {
    expect(parseSampleId("planning-appeal-notification-letter")).toBe("planning-appeal-notification-letter");
    expect(parseSampleId("letter2")).toBe("letter2");
  });

  it("rejects a missing, repeated or malformed ID", () => {
    expect(parseSampleId(undefined)).toBeNull();
    expect(parseSampleId(null)).toBeNull();
    expect(parseSampleId("")).toBeNull();
    expect(parseSampleId(["a", "b"])).toBeNull();
    expect(parseSampleId("../secret")).toBeNull();
    expect(parseSampleId("Letter")).toBeNull();
    expect(parseSampleId("a--b")).toBeNull();
    expect(parseSampleId("-a")).toBeNull();
    expect(parseSampleId("a b")).toBeNull();
    expect(parseSampleId("a".repeat(101))).toBeNull();
  });

  it("property: anything it accepts is only lowercase letters, digits and single hyphens", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        const id = parseSampleId(s);
        if (id !== null) {
          expect(id).toBe(s);
          expect(/^[a-z0-9-]+$/u.test(id)).toBe(true);
          expect(id.includes("--")).toBe(false);
        }
      }),
    );
  });
});

describe("resultHref", () => {
  it("puts only a valid sample ID in the URL", () => {
    expect(resultHref(null)).toBe("/result");
    expect(resultHref("council-tax")).toBe("/result?sample=council-tax");
    expect(resultHref("Pay £45 by 1 April")).toBe("/result");
  });

  it("property: the href round-trips through the search param", () => {
    const id = fc.stringMatching(/^[a-z0-9]{1,8}(-[a-z0-9]{1,8}){0,4}$/u);
    fc.assert(
      fc.property(id, (sample) => {
        const href = resultHref(sample);
        const parsed = new URL(href, "http://localhost").searchParams.get("sample");
        expect(parseSampleId(parsed)).toBe(sample);
      }),
    );
  });
});
