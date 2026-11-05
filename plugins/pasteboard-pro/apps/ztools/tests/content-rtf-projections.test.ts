import { describe, expect, it } from "vitest";
import {
  MAX_RTF_PROJECTION_UNITS_V2,
  RtfPrivacyOutputV2,
} from "../preload/content-rtf-projections";

describe("RTF privacy output budget", () => {
  it("shares ordinary visible text across the four projection views", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");

    output.append(stream, "plain ", "both", false);
    output.append(stream, "text", "both", false);

    expect(output.snapshot()).toEqual([{ role: "body", values: ["plain text"] }]);
  });

  it("keeps modern and legacy Unicode runs separate through hidden text", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");

    output.append(stream, "base", "both", false);
    output.append(stream, "Ω", "modern", false);
    output.append(stream, "A", "legacy", false);
    output.append(stream, "hidden", "both", true);
    output.append(stream, " tail", "both", false);

    expect(output.snapshot()).toEqual([{
      role: "body",
      values: [
        "baseΩhidden tail",
        "baseAhidden tail",
        "baseΩ tail",
        "baseA tail",
      ],
    }]);
  });

  it("keeps hidden text in the full view while omitting it from visible text", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");

    output.append(stream, "pri", "both", false);
    output.append(stream, "vate", "both", true);
    output.append(stream, "-text", "both", false);

    expect(output.snapshot()).toEqual([{
      role: "body",
      values: ["private-text", "pri-text"],
    }]);
  });

  it("does not share output between separate destinations", () => {
    const output = new RtfPrivacyOutputV2();
    const body = output.createStream("body");
    const field = output.createStream("field");

    output.append(body, "visible", "both", false);
    output.append(body, "hidden", "both", true);
    output.append(field, "field result", "both", false);

    expect(output.snapshot()).toEqual([
      { role: "body", values: ["visiblehidden", "visible"] },
      { role: "field", values: ["field result"] },
    ]);
  });

  it("accepts the exact ordinary shared-output budget and rejects one extra unit", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");
    const maximum = "x".repeat(MAX_RTF_PROJECTION_UNITS_V2);

    output.append(stream, maximum, "both", false);
    expect(output.snapshot()).toEqual([{ role: "body", values: [maximum] }]);
    expect(() => output.append(stream, "y", "both", false))
      .toThrow("rtf-projection-unavailable");
    expect(output.snapshot()).toEqual([{ role: "body", values: [maximum] }]);
  });

  it("charges a divergent fork for copying its accumulated prefix", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");
    const maximum = "p".repeat(MAX_RTF_PROJECTION_UNITS_V2);

    output.append(stream, maximum, "both", false);
    expect(() => output.append(stream, "m", "modern", false))
      .toThrow("rtf-projection-unavailable");
    expect(output.snapshot()).toEqual([{ role: "body", values: [maximum] }]);
  });

  it("reserves projection cost separately without truncation or partial charge", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");
    const reservation = "r".repeat(MAX_RTF_PROJECTION_UNITS_V2);

    expect(output.reserveProjection(reservation)).toBe(true);
    expect(output.snapshot()).toEqual([{ role: "body", values: [""] }]);
    expect(output.reserveProjection("x")).toBe(false);
    expect(() => output.append(stream, "visible", "both", false))
      .toThrow("rtf-projection-unavailable");
    expect(output.snapshot()).toEqual([{ role: "body", values: [""] }]);
  });

  it("leaves output unchanged when a reservation exceeds the remaining budget", () => {
    const output = new RtfPrivacyOutputV2();
    const stream = output.createStream("body");

    output.append(stream, "safe", "both", false);
    expect(output.reserveProjection("x".repeat(MAX_RTF_PROJECTION_UNITS_V2)))
      .toBe(false);
    output.append(stream, " text", "both", false);

    expect(output.snapshot()).toEqual([{ role: "body", values: ["safe text"] }]);
  });
});
