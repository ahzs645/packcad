import AppKit

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let width: CGFloat = 1400
let height: CGFloat = 1880
let margin: CGFloat = 40
let gap: CGFloat = 20
let columnWidth: CGFloat = 650

func load(_ name: String) -> NSImage {
    guard let image = NSImage(contentsOf: directory.appendingPathComponent(name)) else {
        fatalError("Unable to load \(name)")
    }
    return image
}

let source = load("k5-source.png")
let local = load("k5-local.png")
let canvas = NSImage(size: NSSize(width: width, height: height))
canvas.lockFocus()

func topRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    NSRect(x: x, y: height - y - h, width: w, height: h)
}

func fill(_ color: NSColor, _ rect: NSRect) {
    color.setFill()
    rect.fill()
}

func label(
    _ value: String,
    x: CGFloat,
    y: CGFloat,
    w: CGFloat,
    h: CGFloat,
    size: CGFloat,
    weight: NSFont.Weight = .regular,
    color: NSColor = NSColor(calibratedRed: 0.09, green: 0.13, blue: 0.20, alpha: 1)
) {
    (value as NSString).draw(
        in: topRect(x, y, w, h),
        withAttributes: [
            .font: NSFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: color,
        ]
    )
}

func pairHeader(_ y: CGFloat) {
    fill(NSColor(calibratedRed: 1, green: 0.95, blue: 0.90, alpha: 1), topRect(margin, y, columnWidth, 34))
    fill(NSColor(calibratedRed: 0.91, green: 0.95, blue: 1, alpha: 1), topRect(margin + columnWidth + gap, y, columnWidth, 34))
    label("LIVE PACKCAD REFERENCE", x: margin + 12, y: y + 7, w: columnWidth - 24, h: 22, size: 15, weight: .bold, color: NSColor(calibratedRed: 0.61, green: 0.20, blue: 0.07, alpha: 1))
    label("CURRENT REBUILT FRAMEWORK", x: margin + columnWidth + gap + 12, y: y + 7, w: columnWidth - 24, h: 22, size: 15, weight: .bold, color: NSColor(calibratedRed: 0.10, green: 0.28, blue: 0.70, alpha: 1))
}

func crop(
    _ image: NSImage,
    sx: CGFloat,
    sy: CGFloat,
    sw: CGFloat,
    sh: CGFloat,
    x: CGFloat,
    y: CGFloat,
    w: CGFloat,
    h: CGFloat
) {
    let destination = topRect(x, y, w, h)
    fill(.white, destination)
    image.draw(
        in: destination,
        from: NSRect(x: sx, y: image.size.height - sy - sh, width: sw, height: sh),
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

fill(NSColor(calibratedRed: 0.93, green: 0.95, blue: 0.97, alpha: 1), NSRect(x: 0, y: 0, width: width, height: height))
label("Updated K5 parity", x: margin, y: 28, w: 900, h: 42, size: 31, weight: .bold)
label("Constraint locks, folded hinge seams and exposed board edges · captured 1 Aug 2026", x: margin, y: 74, w: 1200, h: 28, size: 17, color: NSColor(calibratedWhite: 0.37, alpha: 1))
label("The rebuilt lock markers now come from K5’s active crease faces—not the fixed floor’s neighboring walls.", x: margin, y: 106, w: 1280, h: 28, size: 15, color: NSColor(calibratedWhite: 0.40, alpha: 1))

var y: CGFloat = 154
label("Full K5 model", x: margin, y: y, w: 900, h: 30, size: 22, weight: .semibold)
y += 36
pairHeader(y)
y += 34
crop(source, sx: 255, sy: 34, sw: 730, sh: 630, x: margin, y: y, w: columnWidth, h: 561)
crop(local, sx: 255, sy: 34, sw: 730, sh: 630, x: margin + columnWidth + gap, y: y, w: columnWidth, h: 561)
y += 585

label("Zoom 1 — active K5 constraint markers", x: margin, y: y, w: 1000, h: 30, size: 22, weight: .semibold)
y += 36
pairHeader(y)
y += 34
crop(source, sx: 620, sy: 55, sw: 365, sh: 390, x: margin, y: y, w: columnWidth, h: 430)
crop(local, sx: 650, sy: 55, sw: 335, sh: 390, x: margin + columnWidth + gap, y: y, w: columnWidth, h: 430)
y += 454

label("Zoom 2 — warm hinge seams and sidewall thickness", x: margin, y: y, w: 1100, h: 30, size: 22, weight: .semibold)
y += 36
pairHeader(y)
y += 34
crop(source, sx: 520, sy: 350, sw: 465, sh: 300, x: margin, y: y, w: columnWidth, h: 420)
crop(local, sx: 520, sy: 330, sw: 465, sh: 300, x: margin + columnWidth + gap, y: y, w: columnWidth, h: 420)
y += 432
label("White face-material bridges and beige ribbons have been replaced with the source-style dark warm seam treatment.", x: margin, y: y, w: 1280, h: 30, size: 15, color: NSColor(calibratedWhite: 0.38, alpha: 1))

canvas.unlockFocus()

guard
    let tiff = canvas.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fatalError("Unable to encode comparison")
}

try png.write(to: directory.appendingPathComponent("updated-k5-source-vs-local.png"))
