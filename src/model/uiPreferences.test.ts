import { describe, expect, it } from "vitest";
import {
  defaultUiPreferences,
  normalizeUiPreferences,
  preferencesForLoadedProject,
} from "./uiPreferences";
import { createMailerBoxProject } from "@packcad/fold-solver";
import { createProject } from "@packcad/format";

describe("PackCAD UI preferences", () => {
  it("defaults the Mailer Box controls to the live example settings", () => {
    expect(defaultUiPreferences).toMatchObject({
      schemaVersion: 4,
      units: "in",
      fluteSize: "E Flute",
      fluteAngle: 0,
      offsetDirection: "bottom",
      backgroundColor: "#f2f2f3",
      cameraType: "orthographic",
      panelColorMode: "artwork",
      groundPlane: true,
      shadow: true,
      origin: true,
    });
  });

  it("upgrades the old stock defaults without replacing a chosen flute", () => {
    expect(normalizeUiPreferences({
      schemaVersion: 3,
      units: "mm",
      fluteSize: "F Flute",
    })).toMatchObject({
      schemaVersion: 4,
      units: "in",
      fluteSize: "E Flute",
    });

    expect(normalizeUiPreferences({
      schemaVersion: 3,
      fluteSize: "B Flute",
    }).fluteSize).toBe("B Flute");
  });

  it("loads the bundled example consistently despite unrelated saved settings", () => {
    const mismatched: typeof defaultUiPreferences = {
      ...defaultUiPreferences,
      units: "mm",
      panelColorMode: "material",
      edgeColorMode: "hidden",
      groundPlane: false,
      shadow: false,
      origin: false,
      backgroundColor: "#101010",
      cameraType: "perspective",
      fluteSize: "A Flute",
      fluteAngle: 45,
      offsetDirection: "top",
    };

    expect(preferencesForLoadedProject(
      createMailerBoxProject(),
      mismatched,
    )).toEqual(defaultUiPreferences);
    expect(preferencesForLoadedProject(createProject(), mismatched)).toBe(
      mismatched,
    );
  });
});
