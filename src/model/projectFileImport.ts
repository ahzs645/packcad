import type { PackagingProject } from "@packcad/format";
import { projectFromFileText } from "./projectImport";

export const PROJECT_FILE_ACCEPT =
  ".pdf,.json,.packcad.json,application/pdf,application/json";

const MAX_PDF_FILE_BYTES = 128 * 1024 * 1024;
const MAX_JSON_FILE_BYTES = 32 * 1024 * 1024;
const HEADER_BYTES = 1024;

type ProjectFile = Pick<
  File,
  "name" | "type" | "size" | "slice" | "arrayBuffer"
>;

function hasPdfHeader(bytes: Uint8Array): boolean {
  let offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? 3
    : 0;
  while ([0x09, 0x0a, 0x0c, 0x0d, 0x20].includes(bytes[offset])) offset += 1;
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every(
    (byte, index) => bytes[offset + index] === byte,
  );
}

/** Read PDF input without allocating oversized uploads; parsing belongs to the codec. */
export async function pdfBytesFromFile(
  file: Pick<File, "size" | "arrayBuffer">,
): Promise<Uint8Array> {
  if (file.size > MAX_PDF_FILE_BYTES) {
    throw new Error("PDF files must be 128 MiB or smaller.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** Open complete project files; printed PDF paths are never inferred as a net. */
export async function projectFromFile(file: ProjectFile): Promise<PackagingProject> {
  if (file.size > MAX_PDF_FILE_BYTES) {
    throw new Error("Project files must be 128 MiB or smaller.");
  }

  // Probe only a small header before applying the format-specific full-read limit.
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  const isPdf = /\.pdf$/i.test(file.name)
    || mime === "application/pdf"
    || hasPdfHeader(header);

  if (!isPdf && file.size > MAX_JSON_FILE_BYTES) {
    throw new Error("JSON project files must be 32 MiB or smaller.");
  }

  const bytes = isPdf
    ? await pdfBytesFromFile(file)
    : new Uint8Array(await file.arrayBuffer());
  if (isPdf) {
    const { projectFromPdfBytes } = await import("./projectPdf");
    return projectFromPdfBytes(bytes);
  }

  const text = new TextDecoder().decode(bytes);
  if (!/\.json$/i.test(file.name)
    && mime !== "application/json"
    && !/^\s*[[{]/.test(text)) {
    throw new Error(
      "Choose a PackCAD PDF or JSON project. Use Import Dieline for SVG or DXF files.",
    );
  }
  return projectFromFileText(text);
}
