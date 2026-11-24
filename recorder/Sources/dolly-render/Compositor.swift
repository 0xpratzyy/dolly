import AppKit
import CoreImage
import CoreText
import CoreVideo
import Metal

/// Draws one output frame on the GPU (Core Image on Metal). Everything that never changes (wallpaper, shadow, window,
/// chrome, the rounded mask, cursor sprites, caption pictures) is built once; a frame is then a handful of textured quads.
/// Colour is left unmanaged on purpose: 8-bit values go through as they are and blend in gamma space, like a browser does,
/// so the picture matches the Remotion render.
final class Compositor {
    let spec: Spec
    let W: CGFloat, H: CGFloat
    let context: CIContext
    private let plate: CIImage      // background + shadows + window (or, with a video background, only shadows + window, transparent)
    private let videoBg: Spec.Background?
    private var grain: CIImage?, vignette: CIImage?
    private var bubbleUnder: CIImage?, bubbleMask: CIImage?
    private let mask: CIImage
    private let contentRect: CGRect
    private let black: CIImage
    private var overlays: [CIImage?] = []
    private var sprites: [(scale: CGFloat, image: CIImage, soft: CIImage, hot: CGPoint)] = []
    private let unmanaged: [CIImageOption: Any] = [.colorSpace: NSNull()]
    private let ice = CIColor(red: 134 / 255, green: 228 / 255, blue: 240 / 255, alpha: 1)

    init(spec: Spec) throws {
        self.spec = spec
        W = CGFloat(spec.width); H = CGFloat(spec.height)
        guard let device = MTLCreateSystemDefaultDevice() else { throw Fail("no Metal device") }
        context = CIContext(mtlDevice: device, options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false, .name: "dolly-render"])
        let c = spec.layout.content
        contentRect = CGRect(x: c.x, y: Double(spec.height) - c.y - c.h, width: c.w, height: c.h)
        black = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 1)).cropped(to: contentRect)
        let canvas = CGRect(x: 0, y: 0, width: W, height: H)

        // ---- the plate: background, shadows, window box, chrome (rendered once into a texture)
        videoBg = spec.background.kind == "video" ? spec.background : nil
        var img = videoBg != nil ? CIImage.empty() : try Compositor.background(spec, canvas: canvas)
        let box = spec.layout.box
        let boxRect = CGRect(x: box.x, y: Double(spec.height) - box.y - box.h, width: box.w, height: box.h)
        let radius = CGFloat(spec.layout.radius)
        for s in spec.shadows.reversed() where s.blur > 0 { // CSS box-shadow: gaussian sigma = blur / 2; the first one is on top
            let r = boxRect.insetBy(dx: -s.spread, dy: -s.spread).offsetBy(dx: 0, dy: -s.dy)
            let col = CIColor(red: s.color[0] / 255, green: s.color[1] / 255, blue: s.color[2] / 255, alpha: s.color[3])
            let shape = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: r), "inputRadius": min(radius + s.spread, min(r.width, r.height) / 2), "inputSmoothness": 1.0, "inputColor": col])!.outputImage!
            img = shape.applyingGaussianBlur(sigma: s.blur / 2).cropped(to: canvas).composited(over: img)
        }
        img = Compositor.windowLayer(spec, boxRect: boxRect, radius: radius).composited(over: img)
        plate = try Compositor.bake(img, canvas: canvas, context: context)
        if let vb = videoBg {
            let load = { (p: String?) -> CIImage? in
                guard let p, !p.isEmpty, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
                return CIImage(cgImage: cg, options: [.colorSpace: NSNull()])
            }
            if (vb.grainOpacity ?? 0) > 0, let g = load(vb.grain) { grain = try Compositor.bake(g.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: vb.grainOpacity ?? 0)]), canvas: canvas, context: context) }
            if let v = load(vb.vignette) { vignette = try Compositor.bake(v, canvas: canvas, context: context) }
        }
        // ---- face-cam bubble: its shadow, ring and dark fill at the origin (moved per frame), and the mask of its shape
        if let fc = spec.facecam {
            let r = CGRect(x: 0, y: 0, width: fc.w, height: fc.h)
            let rad = min(fc.radius, min(fc.w, fc.h) / 2)
            var under = CIImage.empty()
            for s in fc.shadows.reversed() {
                let col = CIColor(red: s.color[0] / 255, green: s.color[1] / 255, blue: s.color[2] / 255, alpha: s.color[3])
                let shape = CIFilter(name: "CIRoundedRectangleGenerator", parameters: ["inputExtent": CIVector(cgRect: r.offsetBy(dx: 0, dy: -s.dy)), "inputRadius": rad, "inputSmoothness": 1.0, "inputColor": col])!.outputImage!
                under = shape.applyingGaussianBlur(sigma: s.blur / 2).composited(over: under)
            }
            let pad = 8 + Int(ceil(fc.ring?.width ?? 0))
            let bc = Compositor.bitmap(Int(ceil(fc.w)) + 2 * pad, Int(ceil(fc.h)) + 2 * pad)
            bc.translateBy(x: CGFloat(pad), y: CGFloat(pad))
            let rr = { (q: CGRect, k: CGFloat) in CGPath(roundedRect: q, cornerWidth: min(k, q.width / 2), cornerHeight: min(k, q.height / 2), transform: nil) }
            if let ring = fc.ring {
                bc.addPath(rr(r.insetBy(dx: -ring.width, dy: -ring.width), rad + ring.width))
                bc.setFillColor(CGColor(srgbRed: ring.color[0] / 255, green: ring.color[1] / 255, blue: ring.color[2] / 255, alpha: ring.color[3])); bc.fillPath()
            }
            bc.addPath(rr(r, rad)); bc.setFillColor(CGColor(srgbRed: 17 / 255, green: 17 / 255, blue: 17 / 255, alpha: 1)); bc.fillPath()
            under = CIImage(cgImage: bc.makeImage()!, options: unmanaged).transformed(by: CGAffineTransform(translationX: -CGFloat(pad), y: -CGFloat(pad))).composited(over: under)
            let ext = r.insetBy(dx: -120 * spec.layout.u - 20, dy: -120 * spec.layout.u - 20)
            bubbleUnder = try Compositor.bakeLocal(under, rect: ext, context: context)
            let mk = Compositor.bitmap(Int(ceil(fc.w)), Int(ceil(fc.h)))
            mk.addPath(rr(r, rad)); mk.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)); mk.fillPath()
            bubbleMask = CIImage(cgImage: mk.makeImage()!, options: unmanaged)
        }

        // ---- the mask of the video area: the content rect inside the window's rounded corners
        let mc = Compositor.bitmap(spec.width, spec.height)
        mc.addPath(CGPath(roundedRect: boxRect, cornerWidth: min(radius, boxRect.width / 2), cornerHeight: min(radius, boxRect.height / 2), transform: nil))
        mc.clip()
        mc.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        mc.fill(contentRect)
        mask = try Compositor.bake(CIImage(cgImage: mc.makeImage()!, options: unmanaged), canvas: canvas, context: context)

        // ---- caption states and keystroke pills (transparent PNGs the size of the canvas), cut down to what they cover
        for p in spec.images {
            guard !p.isEmpty, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil), let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { overlays.append(nil); continue }
            overlays.append(Compositor.trimmed(cg, unmanaged))
        }

        // ---- cursor sprites: the vector cursor drawn at three sizes (full zoom, 1/2, 1/4), so it is never scaled up
        if let cur = spec.cursor {
            let minVw = spec.f.map { $0[3] }.min() ?? spec.source.width
            let top = CGFloat(spec.layout.scaleW / max(1, minVw))
            for d in [1.0, 0.5, 0.25] {
                let s = top * d
                let (a, hot) = Compositor.cursorSprite(cur, scale: s, shadow: true)
                let (b, _) = Compositor.cursorSprite(cur, scale: s, shadow: false)
                sprites.append((s, CIImage(cgImage: a, options: unmanaged), CIImage(cgImage: b, options: unmanaged), hot))
            }
        }
    }

    // ------------------------------------------------------------------ one frame
    /// `video` is the decoded source frame (already blended when needed), `cover` a frozen frame with its opacity.
    func frame(_ i: Int, video: CIImage, cover: (CIImage, Double)?, face: CIImage?) -> CIImage {
        let row = spec.f[i]
        let vx = row[1], vy = row[2], vw = row[3], cx = row[4], cy = row[5], co = row[6], press = row[7], bx = row[8], by = row[9]
        let ex = spec.x[String(i)]
        let c = spec.layout.content
        let k = spec.layout.scaleW / vw
        let SW = spec.source.width, SH = spec.source.height
        // source px (top-left origin) -> canvas (Core Image: bottom-left origin)
        let px = { (x: Double) in c.x + (x - vx) * k }
        let py = { (y: Double) in Double(self.H) - (c.y + (y - vy) * k) }

        func place(_ im: CIImage) -> CIImage {
            let e = im.extent
            let sx = k * SW / e.width, sy = k * SH / e.height
            var v = im
            if sx < 0.5 { // a big shrink: filter properly first
                v = v.applyingFilter("CILanczosScaleTransform", parameters: ["inputScale": sy, "inputAspectRatio": sx / sy])
                return v.transformed(by: CGAffineTransform(translationX: c.x - vx * k, y: Double(H) - c.y - (SH - vy) * k))
            }
            return v.transformed(by: CGAffineTransform(a: sx, b: 0, c: 0, d: sy, tx: c.x - vx * k, ty: Double(H) - c.y - (SH - vy) * k))
        }
        var layer = place(video)
        if let (cv, o) = cover, o > 0.003 {
            let top = place(cv)
            layer = o >= 0.997 ? top : layer.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": top, "inputTime": o])
        }
        // click circles, then the cursor trail, then the cursor (all in source space, under the camera blur)
        for r in ex?.rip ?? [] { layer = ring(CGPoint(x: px(r[0]), y: py(r[1])), r: r[2] * k, border: r[3] * k, opacity: r[4], fill: r[5]).composited(over: layer) }
        if spec.cursor != nil, co > 0 {
            for g in ex?.gh ?? [] { layer = cursor(at: CGPoint(x: px(g[0]), y: py(g[1])), scale: k * press, opacity: g[2], soft: true).composited(over: layer) }
            layer = cursor(at: CGPoint(x: px(cx), y: py(cy)), scale: k * press, opacity: co, soft: false).composited(over: layer)
        }
        if bx > 0 || by > 0 {
            layer = layer.cropped(to: contentRect.insetBy(dx: -60, dy: -60)).applyingFilter("CIGaussianBlurXY", parameters: ["inputSigmaX": bx, "inputSigmaY": by])
        }
        var back = plate
        if let vb = videoBg { back = plate.composited(over: liveBackground(video, vb)) }
        var out = layer.cropped(to: contentRect).composited(over: black)
            .applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: back, kCIInputMaskImageKey: mask])
        if let fc = spec.facecam, let face, let under = bubbleUnder, let bm = bubbleMask, i < fc.f.count, fc.f[i][2] > 0.003 {
            let p = fc.f[i] // [x, y (top-left), opacity, scale about the centre]
            // the clip covers the bubble (object-fit: cover), mirrored when asked
            let e = face.extent
            let s = max(fc.w / e.width, fc.h / e.height)
            var v = face.transformed(by: CGAffineTransform(a: fc.mirror ? -s : s, b: 0, c: 0, d: s, tx: (fc.mirror ? e.width * s : 0) + (fc.w - e.width * s) / 2, ty: (fc.h - e.height * s) / 2))
            v = v.cropped(to: CGRect(x: 0, y: 0, width: fc.w, height: fc.h)).applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: under, kCIInputMaskImageKey: bm])
            let sc = p[3]
            let ox = p[0], oy = Double(H) - p[1] - fc.h
            let t = CGAffineTransform(a: sc, b: 0, c: 0, d: sc, tx: ox + fc.w / 2 * (1 - sc), ty: oy + fc.h / 2 * (1 - sc))
            out = fade(v.transformed(by: t), p[2]).composited(over: out)
        }
        if let key = ex?.key, let im = overlay(Int(key[0])) {
            out = fade(im.transformed(by: CGAffineTransform(translationX: 0, y: -key[2])), key[1]).composited(over: out)
        }
        if let cap = ex?.cap, let a = overlay(Int(cap[0])) {
            var im = a
            if cap[1] >= 0, let b = overlay(Int(cap[1])) { im = a.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": b, "inputTime": cap[2]]) }
            out = fade(im, cap[3]).composited(over: out)
        }
        return out
    }

    /// Background type video: the recording covering the canvas, blurred, darkened and a little more saturated, x `scale`.
    private func liveBackground(_ video: CIImage, _ vb: Spec.Background) -> CIImage {
        let canvas = CGRect(x: 0, y: 0, width: W, height: H)
        let e = video.extent
        let s = max(W / e.width, H / e.height)
        var im = video.transformed(by: CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: (W - e.width * s) / 2, ty: (H - e.height * s) / 2))
        // CSS: filter: blur() brightness() saturate() on the canvas-sized layer (edges fade to transparent), then scale about the centre
        if let b = vb.blur, b > 0 { im = im.cropped(to: canvas).applyingGaussianBlur(sigma: b) }
        let br = vb.brightness ?? 1, sa = vb.saturate ?? 1
        let lr = 0.213, lg = 0.715, lb = 0.072
        im = im.applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: br * (lr + (1 - lr) * sa), y: br * (lg - lg * sa), z: br * (lb - lb * sa), w: 0),
            "inputGVector": CIVector(x: br * (lr - lr * sa), y: br * (lg + (1 - lg) * sa), z: br * (lb - lb * sa), w: 0),
            "inputBVector": CIVector(x: br * (lr - lr * sa), y: br * (lg - lg * sa), z: br * (lb + (1 - lb) * sa), w: 0),
        ])
        let k = vb.scale ?? 1
        im = im.transformed(by: CGAffineTransform(a: k, b: 0, c: 0, d: k, tx: W / 2 * (1 - k), ty: H / 2 * (1 - k))).cropped(to: canvas)
        im = im.composited(over: CIImage(color: CIColor(red: 12 / 255, green: 12 / 255, blue: 13 / 255, alpha: 1)).cropped(to: canvas))
        if let g = grain { im = g.applyingFilter("CIOverlayBlendMode", parameters: [kCIInputBackgroundImageKey: im]) }
        if let v = vignette { im = v.composited(over: im) }
        return im
    }

    private func overlay(_ i: Int) -> CIImage? { i >= 0 && i < overlays.count ? overlays[i] : nil }

    private func fade(_ im: CIImage, _ o: Double) -> CIImage {
        o >= 0.999 ? im : im.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: o)])
    }

    private func disc(_ c: CGPoint, _ r: CGFloat, _ color: CIColor) -> CIImage {
        CIFilter(name: "CIRadialGradient", parameters: ["inputCenter": CIVector(cgPoint: c), "inputRadius0": max(0, r - 0.5), "inputRadius1": r + 0.5, "inputColor0": color, "inputColor1": CIColor(red: color.red, green: color.green, blue: color.blue, alpha: 0)])!
            .outputImage!.cropped(to: CGRect(x: c.x - r - 2, y: c.y - r - 2, width: 2 * r + 4, height: 2 * r + 4))
    }

    /// A click circle: an ice ring `border` wide (0 = none) around an ice fill of alpha `fill`.
    private func ring(_ c: CGPoint, r: CGFloat, border: CGFloat, opacity: Double, fill: Double) -> CIImage {
        var im = disc(c, r, CIColor(red: ice.red, green: ice.green, blue: ice.blue, alpha: fill))
        if border > 0 {
            let edge = disc(c, r, ice).applyingFilter("CISourceOutCompositing", parameters: [kCIInputBackgroundImageKey: disc(c, max(0, r - border), ice)])
            im = edge.composited(over: im)
        }
        return fade(im, opacity)
    }

    private func cursor(at p: CGPoint, scale: CGFloat, opacity: Double, soft: Bool) -> CIImage {
        // the smallest sprite that is at least as big as needed
        var pick = sprites[0]
        for s in sprites where s.scale >= scale * 0.999 { pick = s }
        let g = scale / pick.scale
        let im = (soft ? pick.soft : pick.image).transformed(by: CGAffineTransform(a: g, b: 0, c: 0, d: g, tx: p.x - pick.hot.x * g, ty: p.y - pick.hot.y * g))
        return fade(im, opacity)
    }

    // ------------------------------------------------------------------ built once
    static func bitmap(_ w: Int, _ h: Int) -> CGContext {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
        ctx.setShouldSmoothFonts(false)
        ctx.interpolationQuality = .high
        return ctx
    }

    /// Renders an image once into a texture-backed image, so it is not recomputed on every frame.
    static func bake(_ img: CIImage, canvas: CGRect, context: CIContext) throws -> CIImage {
        var pb: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary, kCVPixelBufferMetalCompatibilityKey: true]
        CVPixelBufferCreate(nil, Int(canvas.width), Int(canvas.height), kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
        guard let pb else { throw Fail("cannot allocate a \(Int(canvas.width))x\(Int(canvas.height)) buffer") }
        context.render(img, to: pb, bounds: canvas, colorSpace: nil)
        return CIImage(cvPixelBuffer: pb, options: [.colorSpace: NSNull()])
    }

    /// Like bake, for a picture around the origin: rendered once into a texture that keeps its place.
    static func bakeLocal(_ img: CIImage, rect: CGRect, context: CIContext) throws -> CIImage {
        let r = rect.integral
        let moved = img.transformed(by: CGAffineTransform(translationX: -r.minX, y: -r.minY))
        let baked = try bake(moved, canvas: CGRect(x: 0, y: 0, width: r.width, height: r.height), context: context)
        return baked.transformed(by: CGAffineTransform(translationX: r.minX, y: r.minY))
    }

    static func background(_ spec: Spec, canvas: CGRect) throws -> CIImage {
        let bg = spec.background
        let base = CIImage(color: CIColor(red: 12 / 255, green: 12 / 255, blue: 13 / 255, alpha: 1)).cropped(to: canvas)
        if bg.kind == "solid" {
            let c = parseColor(bg.color ?? "#0C0C0D")
            return CIImage(color: CIColor(red: c.r, green: c.g, blue: c.b, alpha: c.a)).cropped(to: canvas).composited(over: base)
        }
        guard let path = bg.path, !path.isEmpty, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { throw Fail("cannot read the background image \(bg.path ?? "")") }
        var im = CIImage(cgImage: cg, options: [.colorSpace: NSNull()])
        if bg.kind == "still" { return im.composited(over: base) } // drawn by the studio at canvas size, look included
        // CSS: background-size cover, centred, on a box grown by 2.2 x blur each side, then filter: blur(sigma)
        let blur = CGFloat(bg.blur ?? 0) * CGFloat(spec.layout.u)
        let grow = blur * 2.2
        let bw = canvas.width + 2 * grow, bh = canvas.height + 2 * grow
        let s = max(bw / im.extent.width, bh / im.extent.height)
        im = s < 1 ? im.applyingFilter("CILanczosScaleTransform", parameters: ["inputScale": s, "inputAspectRatio": 1.0]) : im.transformed(by: CGAffineTransform(scaleX: s, y: s))
        im = im.transformed(by: CGAffineTransform(translationX: (canvas.width - im.extent.width) / 2 - im.extent.minX, y: (canvas.height - im.extent.height) / 2 - im.extent.minY))
        if blur > 0 { im = im.clampedToExtent().applyingGaussianBlur(sigma: blur) }
        im = im.cropped(to: canvas).composited(over: base)
        if let dim = bg.dim, dim > 0 { im = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: min(1, dim))).cropped(to: canvas).composited(over: im) }
        return im
    }

    /// The window: the hairline (or glow ring) around it, the black box, and the title bar with its three dots and label.
    static func windowLayer(_ spec: Spec, boxRect: CGRect, radius: CGFloat) -> CIImage {
        let ctx = bitmap(spec.width, spec.height)
        let rr = { (r: CGRect, rad: CGFloat) in CGPath(roundedRect: r, cornerWidth: min(rad, r.width / 2), cornerHeight: min(rad, r.height / 2), transform: nil) }
        for s in spec.shadows.reversed() where s.blur == 0 && s.spread > 0 {
            ctx.addPath(rr(boxRect.insetBy(dx: -s.spread, dy: -s.spread), radius + s.spread))
            ctx.setFillColor(CGColor(srgbRed: s.color[0] / 255, green: s.color[1] / 255, blue: s.color[2] / 255, alpha: s.color[3]))
            ctx.fillPath()
        }
        ctx.addPath(rr(boxRect, radius))
        ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
        ctx.fillPath()
        if let ch = spec.chrome {
            let col = { (s: String) -> CGColor in let c = parseColor(s); return CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: c.a) }
            ctx.saveGState()
            ctx.addPath(rr(boxRect, radius))
            ctx.clip()
            let bar = CGRect(x: boxRect.minX, y: boxRect.maxY - ch.h, width: boxRect.width, height: ch.h)
            ctx.setFillColor(col(ch.bar)); ctx.fill(bar)
            ctx.setFillColor(col(ch.line)); ctx.fill(CGRect(x: bar.minX, y: bar.minY, width: bar.width, height: 1)) // 1 px border-bottom, inside the bar
            let midY = bar.minY + 1 + (ch.h - 1) / 2 // the bar's content box (above the border line)
            for (i, d) in ch.dots.enumerated() {
                ctx.setFillColor(col(d))
                ctx.fillEllipse(in: CGRect(x: bar.minX + ch.padX + Double(i) * (ch.dot + ch.gap), y: midY - ch.dot / 2, width: ch.dot, height: ch.dot))
            }
            let browser = ch.kind == "browser"
            if browser {
                let pw = bar.width * 0.46, ph = 28 * spec.layout.u
                ctx.addPath(rr(CGRect(x: bar.midX - pw / 2, y: midY - ph / 2, width: pw, height: ph), 14 * spec.layout.u))
                ctx.setFillColor(col(ch.pill)); ctx.fillPath()
            }
            if !ch.label.isEmpty {
                let weight: NSFont.Weight = browser ? .medium : .semibold
                let font = NSFont(name: browser ? "Figtree-Medium" : "Figtree-SemiBold", size: ch.fontSize) ?? NSFont.systemFont(ofSize: ch.fontSize, weight: weight)
                var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(cgColor: col(ch.text)) ?? .gray]
                if browser { attrs[.kern] = 0.1 }
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: ch.label, attributes: attrs))
                var asc: CGFloat = 0, desc: CGFloat = 0, lead: CGFloat = 0
                let tw = CGFloat(CTLineGetTypographicBounds(line, &asc, &desc, &lead))
                ctx.textPosition = CGPoint(x: bar.midX - tw / 2, y: midY - (asc + desc) / 2 + desc)
                CTLineDraw(line, ctx)
            }
            ctx.restoreGState()
        }
        return CIImage(cgImage: ctx.makeImage()!, options: [.colorSpace: NSNull()])
    }

    /// The cursor drawn `scale` px per source px. Returns the picture and its hotspot (px from the bottom-left).
    static func cursorSprite(_ cur: Spec.Cursor, scale s: CGFloat, shadow: Bool) -> (CGImage, CGPoint) {
        let size = CGFloat(cur.size) * s, ps = CGFloat(cur.ps) * s
        let m = ceil(1.5 * ps + 2.5 * ps * 1.6) + 3 // room for the drop shadow
        let dark = CGColor(srgbRed: 12 / 255, green: 12 / 255, blue: 13 / 255, alpha: 1)
        let light = CGColor(srgbRed: 242 / 255, green: 243 / 255, blue: 244 / 255, alpha: 1)
        func begin(_ w: CGFloat, _ h: CGFloat) -> CGContext {
            let ctx = bitmap(Int(ceil(w + 2 * m)), Int(ceil(h + 2 * m)))
            if shadow { ctx.setShadow(offset: CGSize(width: 0, height: -1.5 * ps), blur: 2.5 * ps, color: CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.45)) }
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
            return ctx
        }
        if cur.kind == "dot" || cur.kind == "ring" {
            let d = size * (cur.kind == "dot" ? 0.62 : 0.95)
            let ctx = begin(d, d)
            let r = CGRect(x: m, y: CGFloat(ctx.height) - m - d, width: d, height: d)
            let bw = (cur.kind == "dot" ? 2.2 : 3.4) * ps
            ctx.setFillColor(cur.kind == "dot" ? light : CGColor(srgbRed: 242 / 255, green: 243 / 255, blue: 244 / 255, alpha: 0.12))
            ctx.fillEllipse(in: r)
            ctx.setStrokeColor(cur.kind == "dot" ? CGColor(srgbRed: 12 / 255, green: 12 / 255, blue: 13 / 255, alpha: 0.75) : light)
            ctx.setLineWidth(bw)
            ctx.strokeEllipse(in: r.insetBy(dx: bw / 2, dy: bw / 2))
            ctx.endTransparencyLayer()
            return (ctx.makeImage()!, CGPoint(x: r.midX, y: r.midY))
        }
        // arrow / hand: an outlined SVG path in its viewBox, fitted and centred in a `w x h` x size box, hotspot on the top edge
        let sh = cur.shape ?? Spec.Shape(d: "M1 1 L1 18.2 L5.3 14.3 L8.2 21 L11 19.8 L8.1 13.3 L13.9 13.3 Z", vbW: 16, vbH: 23, w: 1, h: 1.45, hotX: 0, stroke: 1.5)
        let bw = size * sh.w, bh = size * sh.h
        let unit = min(bw / sh.vbW, bh / sh.vbH)
        let ctx = begin(bw, bh)
        let top = CGFloat(ctx.height) - m
        ctx.translateBy(x: m + (bw - sh.vbW * unit) / 2, y: top - (bh - sh.vbH * unit) / 2)
        ctx.scaleBy(x: unit, y: -unit)
        let path = svgPath(sh.d)
        ctx.addPath(path); ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)); ctx.fillPath()
        ctx.addPath(path); ctx.setStrokeColor(dark); ctx.setLineWidth(sh.stroke); ctx.setLineJoin(.round); ctx.strokePath()
        ctx.endTransparencyLayer()
        return (ctx.makeImage()!, CGPoint(x: m + size * sh.hotX, y: top))
    }

    /// A transparent picture cut down to the box of its visible pixels (most of a caption still is empty).
    static func trimmed(_ cg: CGImage, _ opts: [CIImageOption: Any]) -> CIImage? {
        let w = cg.width, h = cg.height
        let ctx = bitmap(w, h)
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { return nil }
        let p = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * h)
        var x0 = w, x1 = -1, y0 = h, y1 = -1
        for y in 0..<h {
            let row = p + y * ctx.bytesPerRow
            var x = 0
            while x < w { if row[x * 4 + 3] != 0 { if x < x0 { x0 = x }; if y < y0 { y0 = y }; if y > y1 { y1 = y }; break }; x += 1 }
            if x == w { continue }
            var e = w - 1
            while e > x && row[e * 4 + 3] == 0 { e -= 1 }
            if e > x1 { x1 = e }
        }
        if x1 < x0 { return nil }
        // bitmap rows run top-down; Core Image's origin is bottom-left
        let r = CGRect(x: max(0, x0 - 1), y: max(0, h - 1 - y1 - 1), width: min(w, x1 - x0 + 3), height: min(h, y1 - y0 + 3))
        guard let img = ctx.makeImage() else { return nil }
        return CIImage(cgImage: img, options: opts).cropped(to: r)
    }
}
