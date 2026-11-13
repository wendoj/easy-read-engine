import { describe, expect, it } from "vitest";
import { judgeSourceText } from "@/src/pipeline/source-text";

const s = (id: string, text: string) => ({ id, text, start: 0, end: text.length });

describe("judgeSourceText", () => {
  it("adds a postcode-only sentence to the address above it, for the judge only", () => {
    const out = judgeSourceText([s("s1", "Mr Example\n1 Test Road\nTownley"), s("s2", "AB1 2EF"), s("s3", "Dear Mr Example,")]);
    expect(out.get("s1")).toBe("Mr Example\n1 Test Road\nTownley\nAB1 2EF");
    expect(out.get("s2")).toBe("AB1 2EF");
    expect(out.get("s3")).toBe("Dear Mr Example,");
  });

  it("leaves a sentence alone when it ends a sentence or the next one is not a postcode", () => {
    const out = judgeSourceText([s("s1", "You must pay."), s("s2", "AB1 2EF"), s("s3", "Pay now"), s("s4", "AB1 2EF today")]);
    expect(out.get("s1")).toBe("You must pay.");
    expect(out.get("s3")).toBe("Pay now");
  });
});
