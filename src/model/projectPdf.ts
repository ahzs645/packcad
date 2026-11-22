import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";
import { materials, type PackagingProject } from "@packcad/format";
import { projectFromFileText } from "./projectImport";

/** A native JSON attachment also remains usable after extraction in a PDF reader. */
export const PROJECT_PDF_FILENAME = "packcad-project.packcad.json";
export const PROJECT_PDF_VERSION = 1;
export const PROJECT_PDF_MAX_BYTES = 128 * 1024 * 1024;
export const PROJECT_PDF_MAX_PROJECT_BYTES = 32 * 1024 * 1024;
const MAX_TREE_NODES = 4096;
const MAX_TREE_DEPTH = 64;
const MAX_OBJECTS = 100_000;
const name = PDFName.of;
const FORMAT = name("PackagingProject");

class ProjectPdfError extends Error {}

function fail(message: string): never {
  throw new ProjectPdfError(message);
}

function resolve(pdf: PDFDocument, object: PDFObject | undefined): PDFObject | undefined {
  return object instanceof PDFRef ? pdf.context.lookup(object) : object;
}

function dictionary(pdf: PDFDocument, object: PDFObject | undefined, label: string): PDFDict {
  const resolved = resolve(pdf, object);
  if (!(resolved instanceof PDFDict)) fail(`This PDF has a malformed ${label}.`);
  return resolved;
}

function pdfText(value: PDFObject | undefined): string | undefined {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : undefined;
}

async function loadPdf(input: Uint8Array | ArrayBuffer): Promise<PDFDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > PROJECT_PDF_MAX_BYTES) fail("This PDF exceeds the 128 MiB import limit.");
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    if (!(pdf.catalog instanceof PDFDict) || !(pdf.catalog.lookup(name("Pages")) instanceof PDFDict)) {
      fail("This file is not a readable PDF, or its PDF structure is damaged.");
    }
    return pdf;
  } catch (error) {
    if (error instanceof ProjectPdfError) throw error;
    if (error instanceof Error && /encrypted/i.test(error.message)) {
      fail("Password-protected or encrypted PDFs are not supported. Use an unencrypted copy.");
    }
    fail("This file is not a readable PDF, or its PDF structure is damaged.");
  }
}

type AttachmentEntry = { key: PDFString | PDFHexString; file: PDFObject; spec: PDFDict };
type Attachments = { names?: PDFDict; entries: AttachmentEntry[]; associated: PDFObject[]; projects: PDFDict[]; treeRefs: Set<PDFRef> };

function isProject(spec: PDFDict): boolean {
  return spec.lookup(name("PackCADFormat")) === FORMAT;
}

/** Traverse the standard name tree, including nested Kids, without trusting Limits. */
function readAttachments(pdf: PDFDocument): Attachments {
  const entries: AttachmentEntry[] = [];
  const associated: PDFObject[] = [];
  const projects = new Set<PDFDict>();
  const treeRefs = new Set<PDFRef>();
  const namesValue = pdf.catalog.get(name("Names"));
  const names = namesValue ? dictionary(pdf, namesValue, "Names dictionary") : undefined;
  const root = names?.get(name("EmbeddedFiles"));
  const seen = new Set<PDFDict>();
  let treeNodes = 0;
  const visit = (object: PDFObject, depth: number): void => {
    if (depth > MAX_TREE_DEPTH || ++treeNodes > MAX_TREE_NODES) {
      fail("This PDF's attachment tree exceeds the supported size or depth.");
    }
    const node = dictionary(pdf, object, "attachment tree");
    if (object instanceof PDFRef) treeRefs.add(object);
    if (seen.has(node)) fail("This PDF has a cyclic or repeated attachment-tree node.");
    seen.add(node);
    const pairsValue = node.get(name("Names"));
    if (pairsValue instanceof PDFRef) treeRefs.add(pairsValue);
    const pairs = resolve(pdf, pairsValue);
    if (pairs !== undefined) {
      if (!(pairs instanceof PDFArray) || pairs.size() % 2 !== 0) fail("This PDF has a malformed attachment name list.");
      if (entries.length + pairs.size() / 2 > MAX_TREE_NODES) fail("This PDF has too many attachments.");
      for (let index = 0; index < pairs.size(); index += 2) {
        const key = resolve(pdf, pairs.get(index));
        if (!(key instanceof PDFString || key instanceof PDFHexString)) fail("This PDF has a malformed attachment name.");
        const file = pairs.get(index + 1);
        const spec = dictionary(pdf, file, "attachment file specification");
        entries.push({ key, file, spec });
        if (isProject(spec)) projects.add(spec);
      }
    }
    const kidsValue = node.get(name("Kids"));
    if (kidsValue instanceof PDFRef) treeRefs.add(kidsValue);
    const kids = resolve(pdf, kidsValue);
    if (kids !== undefined) {
      if (!(kids instanceof PDFArray)) fail("This PDF has malformed attachment-tree children.");
      if (kids.size() > MAX_TREE_NODES) fail("This PDF has too many attachment-tree children.");
      for (let index = 0; index < kids.size(); index++) visit(kids.get(index), depth + 1);
    }
  };
  if (root) visit(root, 0);
  const afValue = pdf.catalog.get(name("AF"));
  if (afValue instanceof PDFRef) treeRefs.add(afValue);
  const af = resolve(pdf, afValue);
  if (af !== undefined) {
    if (!(af instanceof PDFArray)) fail("This PDF has a malformed associated-file list.");
    if (af.size() > MAX_TREE_NODES) fail("This PDF has too many associated files.");
    for (let index = 0; index < af.size(); index++) {
      const object = af.get(index);
      const spec = dictionary(pdf, object, "associated-file specification");
      associated.push(object);
      if (isProject(spec)) projects.add(spec);
    }
  }
  return { names, entries, associated, projects: [...projects], treeRefs };
}

/** Inspect parsed objects, never PDF byte patterns or executable PDF actions. */
function inspectObjects(pdf: PDFDocument, inspect: (object: PDFObject) => void): void {
  const stack = pdf.context.enumerateIndirectObjects().map(([, object]) => ({ object, depth: 0 }));
  const seen = new Set<PDFObject>();
  while (stack.length) {
    const { object, depth } = stack.pop()!;
    if (seen.has(object)) continue;
    if (seen.size >= MAX_OBJECTS || depth > MAX_TREE_DEPTH) fail("This PDF's object structure exceeds the supported limits.");
    seen.add(object);
    inspect(object);
    // Indirect objects were all queued above; following their references would
    // revisit ordinary cyclic page/parent links unnecessarily.
    if (object instanceof PDFRef) continue;
    const children = object instanceof PDFDict ? object.values()
      : object instanceof PDFArray ? object.asArray()
        : object instanceof PDFStream ? [object.dict] : [];
    for (const child of children) stack.push({ object: child, depth: depth + 1 });
  }
}

function assertUnsigned(pdf: PDFDocument): void {
  inspectObjects(pdf, object => {
    if (object instanceof PDFDict && object.has(name("Contents"))
      && (object.has(name("ByteRange")) || object.lookup(name("Type")) === name("Sig"))) {
      fail("This PDF contains a digital signature. Adding project data would invalidate it; use an unsigned copy.");
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown, minimum = 0): value is number[] =>
  Array.isArray(value) && value.length >= minimum && value.every(finite);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");
const indices = (value: unknown, size: number, minimum = 0): value is number[] =>
  numbers(value, minimum) && value.every(v => Number.isInteger(v) && v >= 0 && v < size);

/** The existing JSON importer accepts older drafts with a deliberately minimal
 * guard. A PDF must contain a complete native snapshot before it replaces the
 * open document; validate its required shape here without changing JSON import. */
function assertSnapshot(project: PackagingProject): void {
  const p: unknown = project;
  const invalid = () => fail("The embedded data is not a complete, valid native PackCAD project.");
  if (!isRecord(p) || !isRecord(p.artwork) || !isRecord(p.dieline)) invalid();
  const value = p as Record<string, unknown>;
  const artwork = value.artwork as Record<string, unknown>, dieline = value.dieline as Record<string, unknown>;
  if (!["material", "materialSpec", "artworkColor", "activeStepId", "cameraPreset", "projection"].every(key => typeof value[key] === "string")
    || !Object.hasOwn(materials, String(value.material))
    || !finite(value.thicknessMm) || value.thicknessMm < 0 || typeof value.showHelpers !== "boolean"
    || !["2d", "3d"].includes(String(value.viewMode)) || !["solid", "technical"].includes(String(value.renderMode))
    || !["x", "y", "scale", "rotation"].every(key => finite(artwork[key]))
    || !["name", "text"].every(key => typeof dieline[key] === "string")
    || !["sample", "svg", "text"].includes(String(dieline.kind))
    || !Array.isArray(value.foldingSteps) || value.foldingSteps.length === 0
    || !value.foldingSteps.every(step => isRecord(step) && typeof step.id === "string" && typeof step.label === "string" && finite(step.angle))) invalid();
  for (const key of ["imageDataUrl", "backImageDataUrl", "imageName", "backImageName"] as const) {
    if (artwork[key] !== undefined && artwork[key] !== null && typeof artwork[key] !== "string") invalid();
  }
  if (value.design !== undefined && value.design !== null
    && (!isRecord(value.design) || !Array.isArray(value.design.operations) || !isRecord(value.design.modifiers)
      || !value.design.operations.every(op => isRecord(op) && typeof op.id === "string" && typeof op.type === "string"))) invalid();
  if (value.foldModel === undefined || value.foldModel === null) return;
  const m = value.foldModel;
  if (!isRecord(m) || !Array.isArray(m.verticesCoords) || !Array.isArray(m.edgesVertices) || !Array.isArray(m.facesVertices)) invalid();
  const model = m as Record<string, unknown>;
  const vertices = model.verticesCoords as unknown[], edges = model.edgesVertices as unknown[], faces = model.facesVertices as unknown[];
  if (!vertices.length || !faces.length || !vertices.every(row => numbers(row, 2))
    || !edges.every(row => indices(row, vertices.length, 2) && row.length === 2)
    || !faces.every(row => indices(row, vertices.length, 3))
    || !Array.isArray(model.verticesUv) || !model.verticesUv.every(row => numbers(row, 2))
    || !strings(model.verticesIDs) || !strings(model.facesIDs) || !strings(model.edgesAssignment)
    || model.edgesAssignment.length !== edges.length || typeof model.coordinateUnit !== "string"
    || !indices([model.fixedFaceIndex], faces.length, 1)
    || !Array.isArray(model.facesEdges) || model.facesEdges.length !== faces.length || !model.facesEdges.every(row => indices(row, edges.length, 3))
    || !Array.isArray(model.edgeFaces) || model.edgeFaces.length !== edges.length || !model.edgeFaces.every(row => indices(row, faces.length))
    || !Array.isArray(model.transforms) || !model.transforms.every(transform => {
      if (!isRecord(transform)) return false;
      if (transform.kind === "translate") return numbers(transform.offset, 3);
      if (transform.kind === "rotateAxisAngle") return numbers(transform.origin, 3) && numbers(transform.axis, 3) && finite(transform.angleDegrees);
      if (transform.kind === "rotateVectorToVector") return numbers(transform.origin, 3) && numbers(transform.from, 3) && numbers(transform.to, 3);
      return false;
    })
    || !Array.isArray(model.keyframes) || !model.keyframes.every(frame => isRecord(frame)
      && typeof frame.id === "string" && typeof frame.label === "string" && isRecord(frame.creaseAnglesDeg)
      && Object.entries(frame.creaseAnglesDeg).every(([edge, angle]) => indices([Number(edge)], edges.length) && finite(angle))
      && isRecord(frame.creaseEdgeGroup) && Object.values(frame.creaseEdgeGroup).every(finite)
      && indices(frame.fixedFaceIndices, faces.length) && indices(frame.fixedVertexIndices, vertices.length)
      && typeof frame.enforcePriorConstraints === "boolean")) invalid();
}

function projectBytes(project: PackagingProject): Uint8Array {
  const artwork = project?.artwork;
  const source = project?.design?.modifiers?.OPERATION_ARTWORK;
  const assets = {
    "front artwork": artwork?.imageDataUrl,
    "back artwork": artwork?.backImageDataUrl,
    "source front artwork": source?.frontArtwork,
    "source back artwork": source?.backArtwork,
  };
  for (const [label, value] of Object.entries(assets)) {
    if (typeof value === "string" && value.trim() && !/^data:/i.test(value.trim())) {
      fail(`The ${label} is an external or temporary link. Upload/embed that artwork before exporting a self-contained project PDF.`);
    }
  }
  let text: string;
  try {
    text = JSON.stringify(project, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite project value");
      if (typeof value === "function" || typeof value === "symbol") throw new Error("Non-JSON project value");
      return value;
    });
    assertSnapshot(projectFromFileText(text));
  } catch {
    fail("The current PackCAD project cannot be saved as valid project JSON.");
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > PROJECT_PDF_MAX_PROJECT_BYTES) fail("The PackCAD project exceeds the 32 MiB embedded-data limit.");
  return bytes;
}

function compareKeys(left: AttachmentEntry, right: AttachmentEntry): number {
  const a = left.key.asBytes(), b = right.key.asBytes();
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

/** Remove only former project objects that have no remaining PDF references. */
function removeUnreferenced(pdf: PDFDocument, candidates: Set<PDFRef>): void {
  let changed = true;
  while (changed && candidates.size) {
    changed = false;
    const referenced = new Set<PDFRef>();
    inspectObjects(pdf, object => { if (object instanceof PDFRef) referenced.add(object); });
    for (const ref of candidates) {
      if (!referenced.has(ref)) { pdf.context.delete(ref); candidates.delete(ref); changed = true; }
    }
  }
}

/** Add or replace PackCAD data without changing page content or unrelated attachments. */
export async function embedProjectInPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  project: PackagingProject,
): Promise<Uint8Array> {
  const payload = projectBytes(project);
  const pdf = await loadPdf(pdfBytes);
  try {
    assertUnsigned(pdf);
    const attachments = readAttachments(pdf);
    const previous = new Set(attachments.projects);
    const entries = attachments.entries.filter(entry => !previous.has(entry.spec));
    if (entries.some(entry => pdfText(entry.key) === PROJECT_PDF_FILENAME)) {
      fail(`This PDF already has an unrelated attachment named ${PROJECT_PDF_FILENAME}. Rename that attachment before exporting.`);
    }
    const oldObjects = new Set<PDFRef>(attachments.treeRefs);
    for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || !previous.has(object)) continue;
      oldObjects.add(ref);
    }
    for (const spec of previous) {
      const efValue = spec.get(name("EF"));
      if (efValue instanceof PDFRef) oldObjects.add(efValue);
      const ef = resolve(pdf, efValue);
      if (ef instanceof PDFDict) for (const value of ef.values()) if (value instanceof PDFRef) oldObjects.add(value);
    }
    const stream = pdf.context.flateStream(payload, {
      Type: "EmbeddedFile", Subtype: "application/json",
      Params: { Size: payload.length, ModDate: PDFString.fromDate(new Date()) },
    });
    const streamRef = pdf.context.register(stream);
    const spec = pdf.context.obj({
      Type: "Filespec", F: PDFString.of(PROJECT_PDF_FILENAME), UF: PDFHexString.fromText(PROJECT_PDF_FILENAME),
      EF: { F: streamRef, UF: streamRef }, AFRelationship: "Data",
      Desc: PDFHexString.fromText("Complete editable PackCAD project"),
      PackCADFormat: FORMAT, PackCADVersion: PROJECT_PDF_VERSION,
    });
    const file = pdf.context.register(spec);
    entries.push({ key: PDFHexString.fromText(PROJECT_PDF_FILENAME), file, spec });
    entries.sort(compareKeys);
    const names = attachments.names ?? pdf.context.obj({});
    // Flatten this one name tree only; other Names entries and file specs survive.
    names.set(name("EmbeddedFiles"), pdf.context.obj({ Names: entries.flatMap(entry => [entry.key, entry.file]) }));
    if (!attachments.names) pdf.catalog.set(name("Names"), names);
    const associated = attachments.associated.filter(object => !previous.has(dictionary(pdf, object, "associated-file specification")));
    pdf.catalog.set(name("AF"), pdf.context.obj([...associated, file]));
    removeUnreferenced(pdf, oldObjects);
    const result = await pdf.save({ addDefaultPage: false, updateFieldAppearances: false });
    if (result.byteLength > PROJECT_PDF_MAX_BYTES) fail("The resulting PDF exceeds the 128 MiB import limit. Reduce the artwork size.");
    return result;
  } catch (error) {
    if (error instanceof ProjectPdfError) throw error;
    fail("The PDF's attachment structure could not be updated safely.");
  }
}

/** Bound output while inflating; decoding an entire PDF stream first can over-allocate. */
async function attachmentBytes(stream: PDFRawStream): Promise<Uint8Array> {
  const params = stream.dict.lookup(name("Params"));
  const size = params instanceof PDFDict ? params.lookup(name("Size")) : undefined;
  if (size instanceof PDFNumber && (!Number.isSafeInteger(size.asNumber()) || size.asNumber() < 0
    || size.asNumber() > PROJECT_PDF_MAX_PROJECT_BYTES)) fail("The embedded PackCAD project exceeds the 32 MiB data limit or has an invalid size.");
  const filter = stream.dict.lookup(name("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray().map(value => stream.dict.context.lookup(value))
    : filter ? [filter] : [];
  const raw = stream.getContents();
  if (!filters.length) {
    if (raw.length > PROJECT_PDF_MAX_PROJECT_BYTES) fail("The embedded PackCAD project exceeds the 32 MiB data limit.");
    return raw;
  }
  if (filters.length !== 1 || filters[0] !== name("FlateDecode") || stream.dict.has(name("DecodeParms"))) {
    fail("The embedded PackCAD project uses unsupported PDF compression. Re-export it from PackCAD.");
  }
  if (typeof DecompressionStream === "undefined") fail("This browser cannot decompress project attachments. Open the PDF in a current browser.");
  const reader = new Blob([new Uint8Array(raw).buffer]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PROJECT_PDF_MAX_PROJECT_BYTES) fail("The embedded PackCAD project exceeds the 32 MiB data limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Recover explicit PackCAD data; ordinary artwork PDFs are never reverse-engineered. */
export async function projectFromPdfBytes(pdfBytes: Uint8Array | ArrayBuffer): Promise<PackagingProject> {
  const pdf = await loadPdf(pdfBytes);
  try {
    const { projects } = readAttachments(pdf);
    if (!projects.length) fail("This PDF has no embedded PackCAD project. Open a PDF exported with PackCAD project data, or open a .packcad.json project.");
    if (projects.length !== 1) fail("This PDF contains multiple embedded PackCAD projects. Re-export it with one project before opening.");
    const spec = projects[0];
    const version = spec.lookup(name("PackCADVersion"));
    if (!(version instanceof PDFNumber) || version.asNumber() !== PROJECT_PDF_VERSION) {
      fail("This PDF uses an unsupported PackCAD project-data version. Open it with a compatible PackCAD version.");
    }
    const ef = dictionary(pdf, spec.get(name("EF")), "embedded project payload");
    const payload = ef.lookup(name("UF")) ?? ef.lookup(name("F"));
    if (!(payload instanceof PDFRawStream)) fail("This PDF is missing its embedded PackCAD project data.");
    const bytes = await attachmentBytes(payload);
    const project = projectFromFileText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    assertSnapshot(project);
    return project;
  } catch (error) {
    if (error instanceof ProjectPdfError) throw error;
    fail("The embedded PackCAD project is damaged or is not valid project JSON.");
  }
}
