import CoreGraphics
import Foundation

/// The render spec written by studio/scripts/camera-track.mjs (studio/src/track.ts: RenderSpec).
/// All the camera, cursor and layout math is done there; this renderer only applies the numbers.
struct Spec: Decodable {
    struct Rect: Decodable { let x, y, w, h: Double }
    struct Source: Decodable { let width, height, pointScale: Double }
    struct Layout: Decodable { let box, content: Rect; let chromeH, radius, u, scaleW: Double }
    struct Background: Decodable {
        let kind: String
        let color: String?
        let path: String?
        let blur: Double?
        let dim: Double?
        // kind "video": the recording itself, blurred and darkened
        let scale, brightness, saturate, grainOpacity: Double?
        let grain, vignette: String?
    }
    struct Shadow: Decodable { let dy, blur, spread: Double; let color: [Double] }
    struct Chrome: Decodable {
        let kind: String
        let h: Double
        let bar, text, line, pill: String
        let dots: [String]
        let dot, gap, padX, fontSize: Double
        let label: String
    }
    struct Shape: Decodable { let d: String; let vbW, vbH, w, h, hotX, stroke: Double }
    struct Cursor: Decodable { let kind: String; let size, ps: Double; let shape: Shape? }
    struct Ring: Decodable { let width: Double; let color: [Double] }
    struct Facecam: Decodable {
        let path: String
        let startMs, w, h, radius: Double
        let mirror: Bool
        let ring: Ring?
        let shadows: [Shadow2]
        let f: [[Double]]
    }
    struct Shadow2: Decodable { let dy, blur: Double; let color: [Double] }
    struct Cover: Decodable { let ms: Double }
    struct Audio: Decodable { let path: String; let volume, offsetMs: Double; let fadeOutFrames: Int }
    struct Extra: Decodable {
        let rip: [[Double]]?
        let gh: [[Double]]?
        let cap: [Double]?
        let key: [Double]?
        let s2: Double?
        let cov: [Double]?
    }

    let version: Int
    let width, height: Int
    let fps: Double
    let frames: Int
    let video: String
    let source: Source
    let layout: Layout
    let background: Background
    let shadows: [Shadow]
    let chrome: Chrome?
    let cursor: Cursor?
    let facecam: Facecam?
    let images: [String]
    let covers: [Cover]
    let audio: Audio?
    let f: [[Double]]
    let x: [String: Extra]
    let unsupported: [String]
}

struct Fail: Error, CustomStringConvertible {
    let description: String
    init(_ m: String) { description = m }
}

/// "#rgb", "#rrggbb", "rgb(r,g,b)" or "rgba(r,g,b,a)" -> components 0..1.
func parseColor(_ s: String) -> (r: Double, g: Double, b: Double, a: Double) {
    let t = s.trimmingCharacters(in: .whitespaces).lowercased()
    if t.hasPrefix("#") {
        var h = String(t.dropFirst())
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        if h.count == 6, let v = UInt32(h, radix: 16) {
            return (Double((v >> 16) & 255) / 255, Double((v >> 8) & 255) / 255, Double(v & 255) / 255, 1)
        }
    } else if t.hasPrefix("rgb") {
        let n = t.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
        if n.count >= 3 { return (n[0] / 255, n[1] / 255, n[2] / 255, n.count > 3 ? n[3] : 1) }
    }
    return (0.047, 0.047, 0.051, 1)
}

/// An SVG path's `d` (M L H V C S Z, absolute or relative) as a CGPath.
func svgPath(_ d: String) -> CGPath {
    var nums: [CGFloat] = [], cmds: [(Character, [CGFloat])] = []
    var cur: Character?
    var tok = ""
    func flushNum() { if !tok.isEmpty, let v = Double(tok) { nums.append(CGFloat(v)) }; tok = "" }
    func flushCmd() { flushNum(); if let c = cur { cmds.append((c, nums)) }; nums = [] }
    for ch in d {
        if ch.isLetter && ch != "e" { flushCmd(); cur = ch }
        else if ch == "-" { if !tok.isEmpty && !tok.hasSuffix("e") { flushNum() }; tok.append(ch) }
        else if ch == "." { if tok.contains(".") { flushNum() }; tok.append(ch) }
        else if ch.isNumber || ch == "e" { tok.append(ch) }
        else { flushNum() }
    }
    flushCmd()
    let path = CGMutablePath()
    var p = CGPoint.zero, start = CGPoint.zero, lastC: CGPoint?
    for (c, a) in cmds {
        let rel = c.isLowercase
        let o = rel ? p : .zero
        var i = 0
        switch c.uppercased() {
        case "M":
            while i + 1 < a.count { p = CGPoint(x: (rel ? p.x : 0) + a[i], y: (rel ? p.y : 0) + a[i + 1]); if i == 0 { path.move(to: p); start = p } else { path.addLine(to: p) }; i += 2 }
            lastC = nil
        case "L":
            while i + 1 < a.count { p = CGPoint(x: (rel ? p.x : 0) + a[i], y: (rel ? p.y : 0) + a[i + 1]); path.addLine(to: p); i += 2 }
            lastC = nil
        case "H": for v in a { p.x = (rel ? p.x : 0) + v; path.addLine(to: p) }; lastC = nil
        case "V": for v in a { p.y = (rel ? p.y : 0) + v; path.addLine(to: p) }; lastC = nil
        case "C":
            while i + 5 < a.count {
                let b = rel ? p : .zero
                let c1 = CGPoint(x: b.x + a[i], y: b.y + a[i + 1]), c2 = CGPoint(x: b.x + a[i + 2], y: b.y + a[i + 3]), e = CGPoint(x: b.x + a[i + 4], y: b.y + a[i + 5])
                path.addCurve(to: e, control1: c1, control2: c2); lastC = c2; p = e; i += 6
            }
        case "S":
            while i + 3 < a.count {
                let b = rel ? p : .zero
                let c1 = lastC.map { CGPoint(x: 2 * p.x - $0.x, y: 2 * p.y - $0.y) } ?? p
                let c2 = CGPoint(x: b.x + a[i], y: b.y + a[i + 1]), e = CGPoint(x: b.x + a[i + 2], y: b.y + a[i + 3])
                path.addCurve(to: e, control1: c1, control2: c2); lastC = c2; p = e; i += 4
            }
        case "Z": path.closeSubpath(); p = start; lastC = nil
        default: break
        }
        _ = o
    }
    return path
}
