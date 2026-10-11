import { describe, expect, it } from "vitest";
import { __test } from "./AnimatedNumber";

const { parse, format } = __test;
const roundTrip = (text: string) => {
  const { parts, tokens } = parse(text);
  let out = parts[0] ?? "";
  tokens.forEach((t, i) => { out += format(t.value, t) + (parts[i + 1] ?? ""); });
  return out;
};

describe("animated figures land on exactly the original text", () => {
  for (const text of ["₹23,15,660", "₹1.24 Cr + AED 2.14M", "7 deals", "₹68.04 L", "$2,315,660.50", "999,999", "12 bill(s)", "₹0", "FY 2026-27"]) {
    it(text, () => expect(roundTrip(text)).toBe(text));
  }
  it("keeps Indian grouping while counting", () => {
    const t = parse("₹23,15,660").tokens[0]!;
    expect(format(150000, t)).toBe("1,50,000");
  });
  it("keeps western grouping while counting", () => {
    const t = parse("$2,315,660").tokens[0]!;
    expect(format(150000, t)).toBe("150,000");
  });
});
