# PDF projects

A PackCAD PDF combines printable PDF pages with the complete native PackCAD project. A PDF
reader displays the pages normally; PackCAD reads the attached project to restore geometry,
artwork, materials, crease assignments, authored folding stages, and presentation settings.
The PDF itself does not play the folding animation. Open it in PackCAD to edit or play it.

## Workflows

### Export a new project PDF

1. Open or edit a project in PackCAD.
2. Choose **File → Export PDF Project…**.
3. Keep the downloaded `packcad-project.pdf`. Use **Open Project…**, or drag it onto PackCAD,
   to restore the project later.

The visible pages use the existing tiled-dieline exporter. The pages and attached project are
created from the same current project snapshot. This action does not add a new artwork-rendering
pipeline to the dieline exporter.

### Keep an existing artwork PDF

1. Open the matching editable project in PackCAD.
2. Choose **File → Add project to PDF…** and select its printable artwork PDF.
3. Keep the new `<original-name>.packcad.pdf` download.

PackCAD preserves the selected PDF's page content and attaches the current project. The active
document and the original file are unchanged. The PDF container is rewritten, so the resulting
file is not byte-for-byte identical. Existing PackCAD project data is replaced; unrelated
attachments are retained.

Choose a PDF that matches the open project. PackCAD does not compare the printed artwork with
the fold model or regenerate those pages. If you later edit the visible PDF in another program,
that does not update its attached project.

### Open a project PDF

**Open Project…** and drag-and-drop accept both PDF and JSON project files. Opening a valid
project creates a local draft, as opening JSON already does. An import error leaves the active
document in place. SVG and DXF dielines still use **Import Dieline…**.

A normal PDF without embedded PackCAD data cannot recover panel connectivity, fold directions,
or a folding timeline from its printed lines. Open the native JSON project first, then use
**Add project to PDF…** to make a reopenable copy.

## Attachment contract, version 1

| Field | Value |
| --- | --- |
| Attachment filename | `packcad-project.packcad.json` |
| Payload | UTF-8 native `PackagingProject` JSON, with no extra envelope |
| Embedded stream MIME type | `application/json` |
| Standard attachment index | Catalog `/Names` → `/EmbeddedFiles` name tree |
| Associated-file index | Catalog `/AF`, referring to the same file specification |
| File specification `/AFRelationship` | `/Data` |
| File specification `/PackCADFormat` | `/PackagingProject` |
| File specification `/PackCADVersion` | `1` |

The format and version markers identify the payload; a filename alone is insufficient. An
attachment-aware PDF reader can also extract the JSON, which opens as a normal PackCAD JSON
project. The full project is stored, including embedded artwork and optional model metadata.
PackCAD does not execute PDF scripts or reconstruct geometry from page paths when opening it.

The codec reads both flat and nested attachment name trees and document-level associated files.
Export replaces prior marked PackCAD attachments while preserving unrelated attachments and
other name-tree categories. An unrelated attachment using the reserved filename is reported as
a conflict. Import rejects ambiguous files containing more than one distinct marked project.

The codec lives in PackCAD because PackCAD owns the project schema. Atelier remains responsible
for rendering generic drawing pages. The PDF library is loaded only when a PDF operation needs
it. These files are ordinary PDFs with associated data; no PDF/A certification is claimed.

## Supported inputs and preservation

- PDF files are limited to **128 MiB**; native JSON and decoded project attachments to **32 MiB**.
  The decoder also bounds attachment-tree traversal and checks decompressed output size.
- Known artwork asset fields must contain embedded data URLs before export. External or
  temporary artwork links are rejected so the saved project can carry its own artwork.
- Password-protected or encrypted PDFs are unsupported. Adding data to a digitally signed PDF
  is rejected because rewriting it would invalidate the signature. Reading an existing signed
  project PDF does not change that file.
- Invalid PDF structures, invalid project JSON, unsupported format versions, missing data, and
  conflicting attachments produce a visible error. They do not replace the open document.
- Attachments exported here use Flate compression. Import accepts uncompressed or plain
  Flate-compressed project streams; the latter requires browser `DecompressionStream` support.
- Keep the original PackCAD PDF. Optimizers and sanitizers can remove attachments, and printing
  to a new PDF may preserve only the pages. A stripped file can still look correct while no
  longer containing the editable project.

## References

- [PDF Association: Associated Files, Application Note 002](https://pdfa.org/download-area/publications/PDF20_AN002-AF.pdf)
  describes associating machine-readable content with an ordinarily rendered PDF.
- [pdf-lib PDFDocument API](https://pdf-lib.js.org/docs/api/classes/pdfdocument) documents the
  PDF library used to load and save the container.
- [Adobe PDF Optimizer settings](https://helpx.adobe.com/acrobat/desktop/create-documents/optimize-pdfs/pdf-optimizer-settings.html)
  documents the option to discard file attachments.
