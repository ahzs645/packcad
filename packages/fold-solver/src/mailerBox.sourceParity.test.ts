import { describe, expect, it } from "vitest";
import { getEnabledSourceArtwork } from "@packcad/format";
import { createMailerBoxProject } from "./sample";

function dataUrlBytes(value: string | undefined): Uint8Array {
  if (!value) throw new Error("MailerBox artwork is missing");
  const encoded = value.split(",", 2)[1];
  if (!encoded) throw new Error("MailerBox artwork is not a data URL");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

describe("live MailerBox source parity", () => {
  it("uses the website artwork assets rather than the stale opaque interior capture", () => {
    const source = getEnabledSourceArtwork(createMailerBoxProject().design);
    const exterior = dataUrlBytes(source?.frontArtwork);
    const interior = dataUrlBytes(source?.backArtwork);

    expect(source?.frontArtwork).toHaveLength(305_262);
    expect(source?.backArtwork).toHaveLength(247_290);
    expect(exterior.slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(interior.slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    // PNG IHDR colour type 6 = RGBA. The transparent stock area is essential:
    // it lets the corrugated base show through instead of becoming a navy face.
    expect(interior[25]).toBe(6);
  });
});
