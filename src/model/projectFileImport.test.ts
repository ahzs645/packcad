import { beforeAll, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createMailerBoxProject } from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";
import { pdfBytesFromFile, projectFromFile } from "./projectFileImport";
import { embedProjectInPdf } from "./projectPdf";

const MiB = 1024 * 1024;

describe("project file routing", () => {
  let project: PackagingProject;
  let pdfBytes: Uint8Array;
  let plainPdfBytes: Uint8Array;

  beforeAll(async () => {
    project = createMailerBoxProject();
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 200]);
    plainPdfBytes = await pdf.save();
    pdfBytes = await embedProjectInPdf(plainPdfBytes, project);
  });

  it("keeps native JSON project opening compatible", async () => {
    const file = new File([JSON.stringify(project)], "mailer.packcad.json", {
      type: "application/json",
    });

    expect(await projectFromFile(file)).toEqual(project);
  });

  it("keeps original source-format JSON on the existing adapter", async () => {
    const file = new File([JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: project.design,
    })], "source.json");

    const reopened = await projectFromFile(file);
    expect(reopened.foldModel).toEqual(project.foldModel);
    expect(reopened.foldingSteps).toEqual(project.foldingSteps);
  });

  it.each([
    ["project.PDF", "application/octet-stream"],
    ["download", "application/pdf"],
    ["download.bin", "application/octet-stream"],
    ["renamed.json", "application/json"],
  ])("opens PDF bytes from %s (%s)", async (name, type) => {
    const file = new File([Uint8Array.from(pdfBytes)], name, { type });

    expect(await projectFromFile(file)).toEqual(project);
  });

  it("preserves the useful error for a PDF without an embedded project", async () => {
    const file = new File([Uint8Array.from(plainPdfBytes)], "drawing.pdf", {
      type: "application/pdf",
    });

    await expect(projectFromFile(file)).rejects.toThrow(/no embedded PackCAD project/i);
  });

  it.each([
    ["broken.pdf", "application/octet-stream"],
    ["broken", "application/pdf"],
    ["broken.json", "application/json"],
  ])("rejects malformed PDF data in %s without a JSON fallback", async (name, type) => {
    const content = name.endsWith(".json") ? "%PDF-1.7\nbroken" : "not a PDF";
    const file = new File([content], name, { type });

    await expect(projectFromFile(file)).rejects.toThrow(/PDF/i);
  });

  it("directs vector artwork to the separate dieline workflow", async () => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "outline.svg", {
      type: "image/svg+xml",
    });

    await expect(projectFromFile(file)).rejects.toThrow(/Import Dieline/);
  });

  it("does not mistake a PDF mention inside JSON for a binary PDF", async () => {
    const file = new File([JSON.stringify({
      note: "%PDF-1.7 is the export format",
      ...project,
    })], "project.json");

    expect((await projectFromFile(file)).foldModel).toEqual(project.foldModel);
  });

  it("rejects a file over the PDF bound before reading any bytes", async () => {
    const arrayBuffer = vi.fn();
    const slice = vi.fn();

    await expect(projectFromFile({
      name: "too-large.pdf",
      type: "application/pdf",
      size: 128 * MiB + 1,
      arrayBuffer,
      slice,
    })).rejects.toThrow(/128 MiB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
  });

  it("rejects oversized JSON after only the bounded header probe", async () => {
    const arrayBuffer = vi.fn();
    const slice = vi.fn(() => new Blob(['{"foldingSteps":[]']));

    await expect(projectFromFile({
      name: "too-large.json",
      type: "application/json",
      size: 32 * MiB + 1,
      arrayBuffer,
      slice,
    })).rejects.toThrow(/32 MiB/);
    expect(slice).toHaveBeenCalledWith(0, 1024);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("applies the PDF size bound to a renamed PDF identified by its header", async () => {
    const file = new File([Uint8Array.from(pdfBytes)], "renamed.json");
    const arrayBuffer = vi.fn(() => file.arrayBuffer());

    const reopened = await projectFromFile({
      name: file.name,
      type: file.type,
      size: 40 * MiB,
      arrayBuffer,
      slice: (start, end, type) => file.slice(start, end, type),
    });

    expect(reopened).toEqual(project);
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it("passes existing PDF pages to the attachment workflow as unchanged bytes", async () => {
    const file = new File([Uint8Array.from(plainPdfBytes)], "artwork.pdf");

    expect(await pdfBytesFromFile(file)).toEqual(plainPdfBytes);
  });

  it("guards the attachment workflow before reading an oversized PDF", async () => {
    const arrayBuffer = vi.fn();

    await expect(pdfBytesFromFile({
      size: 128 * MiB + 1,
      arrayBuffer,
    })).rejects.toThrow(/128 MiB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
