import AppKit

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let canvasWidth: CGFloat = 1400
let canvasHeight: CGFloat = 3060
let margin: CGFloat = 40
let gap: CGFloat = 20
let columnWidth: CGFloat = 650

func load(_ name: String) -> NSImage {
    guard let image = NSImage(contentsOf: outputDirectory.appendingPathComponent(name)) else {
        fatalError("Unable to load \(name)")
    }
    return image
}

let sourceK4 = load("k4-source.png")
let localK4 = load("k4-local.png")
let sourceK5 = load("k5-source.png")
let localK5 = load("k5-local.png")

let canvas = NSImage(size: NSSize(width: canvasWidth, height: canvasHeight))
canvas.lockFocus()

func topRect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    NSRect(x: x, y: canvasHeight - y - height, width: width, height: height)
}

func fill(_ color: NSColor, _ rect: NSRect) {
    color.setFill()
    rect.fill()
}

func text(
    _ value: String,
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    height: CGFloat,
    size: CGFloat,
    weight: NSFont.Weight = .regular,
    color: NSColor = NSColor(calibratedRed: 0.09, green: 0.13, blue: 0.20, alpha: 1)
) {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: style,
    ]
    (value as NSString).draw(in: topRect(x, y, width, height), withAttributes: attributes)
}

func crop(
    _ image: NSImage,
    sourceX: CGFloat,
    sourceY: CGFloat,
    sourceWidth: CGFloat,
    sourceHeight: CGFloat,
    x: CGFloat,
    y: CGFloat,
    width: CGFloat,
    height: CGFloat
) {
    let destination = topRect(x, y, width, height)
    fill(.white, destination)
    let source = NSRect(
        x: sourceX,
        y: image.size.height - sourceY - sourceHeight,
        width: sourceWidth,
        height: sourceHeight
    )
    image.draw(
        in: destination,
        from: source,
        operation: .copy,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
    NSColor(calibratedWhite: 0.78, alpha: 1).setStroke()
    let border = NSBezierPath(rect: destination)
    border.lineWidth = 2
    border.stroke()
}

func pairHeader(y: CGFloat) {
    fill(NSColor(calibratedRed: 1, green: 0.95, blue: 0.90, alpha: 1), topRect(margin, y, columnWidth, 34))
    fill(NSColor(calibratedRed: 0.91, green: 0.95, blue: 1, alpha: 1), topRect(margin + columnWidth + gap, y, columnWidth, 34))
    text("LIVE PACKCAD REFERENCE", x: margin + 12, y: y + 7, width: columnWidth - 24, height: 23, size: 15, weight: .bold, color: NSColor(calibratedRed: 0.61, green: 0.20, blue: 0.07, alpha: 1))
    text("CURRENT REBUILT FRAMEWORK", x: margin + columnWidth + gap + 12, y: y + 7, width: columnWidth - 24, height: 23, size: 15, weight: .bold, color: NSColor(calibratedRed: 0.10, green: 0.28, blue: 0.70, alpha: 1))
}

fill(NSColor(calibratedRed: 0.93, green: 0.95, blue: 0.97, alpha: 1), NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight))
text("PackCAD folding parity", x: margin, y: 28, width: 900, height: 42, size: 31, weight: .bold)
text("Live reference vs current rebuilt framework · captured 1 Aug 2026", x: margin, y: 73, width: 1000, height: 28, size: 17, color: NSColor(calibratedWhite: 0.37, alpha: 1))
text("Matching 90° keyframes; editor panels are cropped away so the model, artwork and edge treatment can be compared directly.", x: margin, y: 104, width: 1280, height: 36, size: 15, color: NSColor(calibratedWhite: 0.40, alpha: 1))

var y: CGFloat = 158

text("K4 — side returns incorporated into the walls", x: margin, y: y, width: 1100, height: 32, size: 22, weight: .semibold)
y += 38
pairHeader(y: y)
y += 34
crop(sourceK4, sourceX: 255, sourceY: 34, sourceWidth: 730, sourceHeight: 630, x: margin, y: y, width: columnWidth, height: 561)
crop(localK4, sourceX: 255, sourceY: 34, sourceWidth: 730, sourceHeight: 630, x: margin + columnWidth + gap, y: y, width: columnWidth, height: 561)
y += 573
text("The rebuilt narrow returns now take the inward branch and become part of the sidewalls instead of remaining upright/outward.", x: margin, y: y, width: 1280, height: 38, size: 15, color: NSColor(calibratedWhite: 0.38, alpha: 1))
y += 54

text("K5 — final side-flap branch and lid-ear outline", x: margin, y: y, width: 1100, height: 32, size: 22, weight: .semibold)
y += 38
pairHeader(y: y)
y += 34
crop(sourceK5, sourceX: 255, sourceY: 34, sourceWidth: 730, sourceHeight: 630, x: margin, y: y, width: columnWidth, height: 561)
crop(localK5, sourceX: 255, sourceY: 34, sourceWidth: 730, sourceHeight: 630, x: margin + columnWidth + gap, y: y, width: columnWidth, height: 561)
y += 573
text("K5 retains the corrected branch. The rebuilt renderer now follows the source Bézier control points around the lid ears.", x: margin, y: y, width: 1280, height: 38, size: 15, color: NSColor(calibratedWhite: 0.38, alpha: 1))
y += 56

text("Zoom 1 — K4 side-return branch", x: margin, y: y, width: 1100, height: 32, size: 22, weight: .semibold)
y += 38
pairHeader(y: y)
y += 34
crop(sourceK4, sourceX: 500, sourceY: 310, sourceWidth: 480, sourceHeight: 300, x: margin, y: y, width: columnWidth, height: 400)
crop(localK4, sourceX: 360, sourceY: 250, sourceWidth: 500, sourceHeight: 320, x: margin + columnWidth + gap, y: y, width: columnWidth, height: 400)
y += 426

text("Zoom 2 — K5 curved lid ears", x: margin, y: y, width: 1100, height: 32, size: 22, weight: .semibold)
y += 38
pairHeader(y: y)
y += 34
crop(sourceK5, sourceX: 490, sourceY: 35, sourceWidth: 495, sourceHeight: 350, x: margin, y: y, width: columnWidth, height: 450)
crop(localK5, sourceX: 455, sourceY: 34, sourceWidth: 510, sourceHeight: 350, x: margin + columnWidth + gap, y: y, width: columnWidth, height: 450)
y += 476

text("Zoom 3 — exposed thickness and folded crease", x: margin, y: y, width: 1100, height: 32, size: 22, weight: .semibold)
y += 38
pairHeader(y: y)
y += 34
crop(sourceK5, sourceX: 525, sourceY: 385, sourceWidth: 460, sourceHeight: 280, x: margin, y: y, width: columnWidth, height: 380)
crop(localK5, sourceX: 365, sourceY: 315, sourceWidth: 525, sourceHeight: 305, x: margin + columnWidth + gap, y: y, width: columnWidth, height: 380)
y += 393
text("Both use thin white crease strokes. The exposed cut surface is separately rendered as kraft/tan board with a dark boundary.", x: margin, y: y, width: 1280, height: 40, size: 15, color: NSColor(calibratedWhite: 0.38, alpha: 1))

canvas.unlockFocus()

guard
    let tiff = canvas.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fatalError("Unable to encode comparison sheet")
}

try png.write(to: outputDirectory.appendingPathComponent("packcad-k4-k5-side-by-side.png"))
