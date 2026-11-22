import { describe, expect, it } from "vitest";
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream,
  PDFRef, PDFString, decodePDFRawStream, degrees,
} from "pdf-lib";
import { createProject, type PackagingProject } from "@packcad/format";
import { createVhsSlipcoverProject } from "@packcad/fold-solver";
import { projectFromFileText } from "./projectImport";
import {
  embedProjectInPdf, projectFromPdfBytes, PROJECT_PDF_FILENAME, PROJECT_PDF_MAX_BYTES,
  PROJECT_PDF_MAX_PROJECT_BYTES, PROJECT_PDF_VERSION,
} from "./projectPdf";

const name = PDFName.of;
const encoder = new TextEncoder();

async function document() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Existing print document");
  pdf.addPage([400, 230]).drawText("Original page content", { x: 24, y: 100 });
  pdf.addPage([210, 470]).setRotation(degrees(90));
  return pdf;
}

function flatNames(pdf: PDFDocument): PDFArray {
  return pdf.catalog.lookup(name("Names"), PDFDict).lookup(name("EmbeddedFiles"), PDFDict).lookup(name("Names"), PDFArray);
}

function fileSpec(pdf: PDFDocument, index = 0): PDFDict {
  return flatNames(pdf).lookup(index * 2 + 1, PDFDict);
}

function fileStream(spec: PDFDict): PDFRawStream {
  const stream = spec.lookup(name("EF"), PDFDict).lookup(name("F"));
  if (!(stream instanceof PDFRawStream)) throw new Error("Fixture attachment is not a raw stream");
  return stream;
}

function fileContents(spec: PDFDict): Uint8Array {
  return decodePDFRawStream(fileStream(spec)).decode();
}

function mark(spec: PDFDict, version = PROJECT_PDF_VERSION) {
  spec.set(name("PackCADFormat"), name("PackagingProject"));
  spec.set(name("PackCADVersion"), PDFNumber.of(version));
}

async function withPayload(payload: string | Uint8Array, version = PROJECT_PDF_VERSION) {
  const pdf = await document();
  await pdf.attach(typeof payload === "string" ? encoder.encode(payload) : payload, PROJECT_PDF_FILENAME, { mimeType: "application/json" });
  await pdf.flush();
  mark(fileSpec(pdf), version);
  return pdf;
}

function pageContents(pdf: PDFDocument): number[][][] {
  return pdf.getPages().map(page => {
    const contents = page.node.lookup(name("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map(value => pdf.context.lookup(value)) : contents ? [contents] : [];
    return streams.map(stream => Array.from(decodePDFRawStream(stream as PDFRawStream).decode()));
  });
}

function richProject(): PackagingProject {
  const project = createVhsSlipcoverProject();
  project.artwork = { ...project.artwork, uvConvention: "source-atlas", x: 0.23, rotation: 17,
    imageDataUrl: "data:image/png;base64,ZnJvbnQ=", backImageDataUrl: "data:image/png;base64,YmFjaw==",
    imageName: "Front print.png", backImageName: "Back print.png" };
  project.foldModel!.faceSurfaceLayers = project.foldModel!.facesVertices.map((_face, index) => index ? -1.05 : null);
  project.design!.modifiers.OPERATION_ARTWORK = { id: "artwork", type: "OPERATION_ARTWORK", name: "Source print", enabled: true,
    uvConvention: "source-atlas", frontArtwork: "data:image/png;base64,c291cmNl", backArtwork: "data:image/png;base64,c291cmNlLWJhY2s=" };
  // Attribution links are not artwork assets and must remain intact.
  Object.assign(project, { attribution: "https://example.com/credit", futureProjectField: { values: [1, 2, 3] } });
  return project;
}

describe("editable project PDF attachments", () => {
  it("round-trips a complete native project with geometry, timeline, art, and unknown fields", async () => {
    const project = richProject();
    const pdf = await document();
    const bytes = await embedProjectInPdf((await pdf.save()).buffer as ArrayBuffer, project);
    const reopened = await projectFromPdfBytes(bytes);
    expect(reopened).toEqual(JSON.parse(JSON.stringify(project)));
    expect(reopened.foldModel?.rigidTimeline).toBe(true);
    const loaded = await PDFDocument.load(bytes);
    const spec = fileSpec(loaded);
    expect(spec.lookup(name("F"), PDFString).decodeText()).toBe(PROJECT_PDF_FILENAME);
    expect(spec.lookup(name("UF"), PDFHexString).decodeText()).toBe(PROJECT_PDF_FILENAME);
    expect(spec.lookup(name("PackCADVersion"), PDFNumber).asNumber()).toBe(1);
    expect(spec.lookup(name("AFRelationship"))).toBe(name("Data"));
    expect(loaded.catalog.lookup(name("AF"), PDFArray).lookup(0, PDFDict)).toBe(spec);
    const stream = fileStream(spec);
    expect(stream.dict.lookup(name("Subtype"))).toBe(name("application/json"));
    expect(stream.dict.lookup(name("Params"), PDFDict).has(name("ModDate"))).toBe(true);
    expect(projectFromFileText(new TextDecoder().decode(fileContents(spec)))).toEqual(reopened);
  });

  it("preserves every page, its content, metadata, and unrelated attachments from a nested tree", async () => {
    const original = await document();
    await original.attach(encoder.encode("Keep this attachment unchanged."), "notes.txt");
    await original.attach(new Uint8Array([3, 1, 4, 1, 5]), "binary.dat");
    await original.flush();
    const names = original.catalog.lookup(name("Names"), PDFDict);
    const tree = names.lookup(name("EmbeddedFiles"), PDFDict);
    const pairs = tree.lookup(name("Names"), PDFArray);
    const kids = [0, 2].map(index => original.context.register(original.context.obj({ Names: [pairs.get(index), pairs.get(index + 1)] })));
    tree.delete(name("Names"));
    tree.set(name("Kids"), original.context.obj(kids));
    names.set(name("Dests"), original.context.obj({ Names: [] }));
    const before = await PDFDocument.load(await original.save());
    const after = await PDFDocument.load(await embedProjectInPdf(await original.save(), createProject()));
    expect(after.getPages().map(page => [page.getWidth(), page.getHeight(), page.getRotation().angle])).toEqual(
      before.getPages().map(page => [page.getWidth(), page.getHeight(), page.getRotation().angle]),
    );
    expect(pageContents(after)).toEqual(pageContents(before));
    expect(after.getTitle()).toBe("Existing print document");
    expect(after.catalog.lookup(name("Names"), PDFDict).has(name("Dests"))).toBe(true);
    const files = flatNames(after);
    expect(files.size()).toBe(6);
    const attachments = new Map<string, number[]>();
    for (let i = 0; i < files.size(); i += 2) {
      const key = files.lookup(i) as PDFString | PDFHexString;
      attachments.set(key.decodeText(), Array.from(fileContents(files.lookup(i + 1, PDFDict))));
    }
    expect(attachments.get("notes.txt")).toEqual(Array.from(encoder.encode("Keep this attachment unchanged.")));
    expect(attachments.get("binary.dat")).toEqual([3, 1, 4, 1, 5]);
    expect(after.catalog.lookup(name("AF"), PDFArray).size()).toBe(3);
  });

  it("replaces its previous attachment without accumulating visible or orphan project payloads", async () => {
    let bytes = await (await document()).save();
    for (const thicknessMm of [0.1, 0.25, 0.4]) {
      const project = { ...createProject(), thicknessMm };
      bytes = await embedProjectInPdf(bytes, project);
      const loaded = await PDFDocument.load(bytes);
      expect(flatNames(loaded).size()).toBe(2);
      expect(loaded.catalog.lookup(name("AF"), PDFArray).size()).toBe(1);
      expect((await projectFromPdfBytes(bytes)).thicknessMm).toBe(thicknessMm);
      const embeddedStreams = loaded.context.enumerateIndirectObjects().filter(([, object]) =>
        object instanceof PDFRawStream && object.dict.lookup(name("Type")) === name("EmbeddedFile"));
      expect(embeddedStreams).toHaveLength(1);
    }
  });

  it("removes an obsolete project and indirect tree nodes without deleting unrelated or externally referenced files", async () => {
    const pdf = await withPayload(JSON.stringify({ ...createProject(), artworkColor: "obsolete-marker" }));
    await pdf.attach(encoder.encode("Preserve the unrelated file."), "keep.txt");
    await pdf.flush();
    const pairs = flatNames(pdf);
    const oldSpecRef = pairs.get(1) as PDFRef;
    const oldStreamRef = fileSpec(pdf).lookup(name("EF"), PDFDict).get(name("F")) as PDFRef;
    const efRef = pdf.context.register(fileSpec(pdf).lookup(name("EF"), PDFDict));
    fileSpec(pdf).set(name("EF"), efRef);
    const afRef = pdf.context.register(pdf.catalog.lookup(name("AF"), PDFArray));
    pdf.catalog.set(name("AF"), afRef);
    const leafRefs = [0, 2].map(index => pdf.context.register(pdf.context.obj({
      Names: pdf.context.register(pdf.context.obj([pairs.get(index), pairs.get(index + 1)])),
    })));
    const rootRef = pdf.context.register(pdf.context.obj({ Kids: pdf.context.register(pdf.context.obj(leafRefs)) }));
    const names = pdf.catalog.lookup(name("Names"), PDFDict);
    names.set(name("EmbeddedFiles"), rootRef);
    const namesRef = pdf.context.register(names);
    pdf.catalog.set(name("Names"), namesRef);
    const result = await PDFDocument.load(await embedProjectInPdf(await pdf.save(), createProject()));
    expect(result.context.lookup(rootRef)).toBeUndefined();
    expect(result.context.lookup(oldSpecRef)).toBeUndefined();
    expect(result.context.lookup(oldStreamRef)).toBeUndefined();
    expect(result.context.lookup(afRef)).toBeUndefined();
    expect(result.context.lookup(efRef)).toBeUndefined();
    expect(result.catalog.get(name("Names"))).toBe(namesRef);
    expect(result.context.lookup(leafRefs[0])).toBeUndefined();
    const retained = flatNames(result);
    const kept = Array.from({ length: retained.size() / 2 }, (_, index) => retained.lookup(index * 2 + 1, PDFDict))
      .find(spec => (spec.lookup(name("UF")) as PDFHexString).decodeText() === "keep.txt")!;
    expect(new TextDecoder().decode(fileContents(kept))).toBe("Preserve the unrelated file.");
  });

  it("reads a standard associated-file entry even when the Names tree is absent", async () => {
    const pdf = await withPayload(JSON.stringify(createProject()));
    pdf.catalog.delete(name("Names"));
    expect(await projectFromPdfBytes(await pdf.save())).toEqual(createProject());
  });

  it("retains an old payload stream when an unrelated attachment still uses it", async () => {
    const oldProject = { ...createProject(), thicknessMm: 0.35 };
    const pdf = await withPayload(JSON.stringify(oldProject));
    const sharedStream = fileSpec(pdf).lookup(name("EF"), PDFDict).get(name("F"))!;
    await pdf.attach(encoder.encode("temporary fixture payload"), "retained-copy.json");
    await pdf.flush();
    fileSpec(pdf, 1).set(name("EF"), pdf.context.obj({ F: sharedStream }));
    const bytes = await embedProjectInPdf(await pdf.save(), createProject());
    const result = await PDFDocument.load(bytes);
    const names = flatNames(result);
    const retained = Array.from({ length: names.size() / 2 }, (_, index) => names.lookup(index * 2 + 1, PDFDict))
      .find(spec => (spec.lookup(name("UF")) as PDFHexString).decodeText() === "retained-copy.json")!;
    expect(JSON.parse(new TextDecoder().decode(fileContents(retained)))).toEqual(oldProject);
    expect(await projectFromPdfBytes(bytes)).toEqual(createProject());
  });

  it("does not guess geometry from an ordinary PDF or an unmarked JSON attachment", async () => {
    const pdf = await document();
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("no embedded PackCAD project");
    await pdf.attach(encoder.encode(JSON.stringify(createProject())), PROJECT_PDF_FILENAME);
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("no embedded PackCAD project");
    await expect(embedProjectInPdf(await pdf.save(), createProject())).rejects.toThrow("unrelated attachment");
  });

  it("rejects unsupported versions and ambiguous multiple project payloads", async () => {
    const future = await withPayload(JSON.stringify(createProject()), 2);
    await expect(projectFromPdfBytes(await future.save())).rejects.toThrow("unsupported PackCAD project-data version");
    const multiple = await withPayload(JSON.stringify(createProject()));
    await multiple.attach(encoder.encode(JSON.stringify({ ...createProject(), thicknessMm: 2 })), "second-project.json");
    await multiple.flush();
    mark(fileSpec(multiple, 1));
    const bytes = await multiple.save();
    await expect(projectFromPdfBytes(bytes)).rejects.toThrow("multiple embedded PackCAD projects");
    const replaced = await embedProjectInPdf(bytes, createProject());
    expect(await projectFromPdfBytes(replaced)).toEqual(createProject());
    expect(flatNames(await PDFDocument.load(replaced)).size()).toBe(2);
  });

  it.each(["not JSON", "{}", "{\"viewMode\":\"3d\"}"])("rejects invalid project payload %s", async payload => {
    const pdf = await withPayload(payload);
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("not valid project JSON");
  });

  it("rejects an incomplete native-looking snapshot before replacing the current document", async () => {
    const incomplete = await withPayload(JSON.stringify({ foldingSteps: [], activeStepId: "", viewMode: "3d" }));
    await expect(projectFromPdfBytes(await incomplete.save())).rejects.toThrow("not a complete, valid native PackCAD project");
    const brokenModel = await withPayload(JSON.stringify({ ...createProject(), foldModel: { verticesCoords: [] } }));
    await expect(projectFromPdfBytes(await brokenModel.save())).rejects.toThrow("not a complete, valid native PackCAD project");
  });

  it("rejects an otherwise valid snapshot with an unsupported material", async () => {
    const invalidMaterial = await withPayload(JSON.stringify({ ...createProject(), material: "invalid" }));
    await expect(projectFromPdfBytes(await invalidMaterial.save())).rejects.toThrow("not a complete, valid native PackCAD project");
  });

  it("rejects malformed PDF input before reporting a project payload error", async () => {
    for (const value of ["not PDF", "%PDF-1.7\nbroken"]) {
      await expect(projectFromPdfBytes(encoder.encode(value))).rejects.toThrow("not a readable PDF");
    }
  });

  it("rejects encrypted PDFs rather than ignoring their encryption", async () => {
    const pdf = await document();
    pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }));
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("encrypted PDFs are not supported");
  });

  it("refuses to modify signed PDFs, while allowing attachment extraction without changes", async () => {
    const pdf = await withPayload(JSON.stringify(createProject()));
    const signature = pdf.context.register(pdf.context.obj({ Type: "Sig", ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of("0000") }));
    pdf.catalog.set(name("Perms"), pdf.context.obj({ DocMDP: signature }));
    const bytes = await pdf.save();
    await expect(embedProjectInPdf(bytes, createProject())).rejects.toThrow("digital signature");
    expect(await projectFromPdfBytes(bytes)).toEqual(createProject());
  });

  it("rejects cyclic and over-deep attachment trees", async () => {
    const pdf = await document();
    const tree = pdf.context.obj({});
    const ref = pdf.context.register(tree);
    tree.set(name("Kids"), pdf.context.obj([ref]));
    pdf.catalog.set(name("Names"), pdf.context.obj({ EmbeddedFiles: ref }));
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("cyclic");
    await expect(embedProjectInPdf(await pdf.save(), createProject())).rejects.toThrow("cyclic");
    let child: PDFRef = pdf.context.register(pdf.context.obj({ Names: [] }));
    for (let i = 0; i < 66; i++) child = pdf.context.register(pdf.context.obj({ Kids: [child] }));
    pdf.catalog.set(name("Names"), pdf.context.obj({ EmbeddedFiles: child }));
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("size or depth");
  });

  it("enforces PDF and decoded attachment limits, including a false declared stream size", async () => {
    await expect(projectFromPdfBytes(new Uint8Array(PROJECT_PDF_MAX_BYTES + 1))).rejects.toThrow("128 MiB");
    const pdf = await withPayload(new Uint8Array(PROJECT_PDF_MAX_PROJECT_BYTES + 1).fill(65));
    const stream = fileStream(fileSpec(pdf));
    stream.dict.lookup(name("Params"), PDFDict).set(name("Size"), PDFNumber.of(1));
    await expect(projectFromPdfBytes(await pdf.save())).rejects.toThrow("32 MiB");
  });

  it("rejects external and temporary artwork links but accepts ordinary attribution URLs", async () => {
    const pdf = await (await document()).save();
    const project = richProject();
    project.artwork.imageDataUrl = "blob:https://example.com/temporary";
    await expect(embedProjectInPdf(pdf, project)).rejects.toThrow("front artwork is an external or temporary link");
    project.artwork.imageDataUrl = "data:image/png;base64,YQ==";
    project.design!.modifiers.OPERATION_ARTWORK!.backArtwork = "https://example.com/back.png";
    await expect(embedProjectInPdf(pdf, project)).rejects.toThrow("source back artwork is an external or temporary link");
    project.design!.modifiers.OPERATION_ARTWORK!.backArtwork = "data:image/png;base64,Yg==";
    expect((await projectFromPdfBytes(await embedProjectInPdf(pdf, project))).artwork).toEqual(project.artwork);
  });
});
