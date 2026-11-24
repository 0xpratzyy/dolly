import CoreGraphics

/// The captured area (a whole display or one window) in global screen space.
///
/// `frame` is in **Quartz global coordinates**: points, origin at the top-left of the
/// primary display, y growing downward. That is what `CGEvent.location`, `CGDisplayBounds`,
/// `SCDisplay.frame` and `SCWindow.frame` all use, so secondary displays can have negative
/// origins. (AppKit's `NSEvent.mouseLocation` is bottom-left based; see `ScreenSpace`.)
public struct CaptureRegion: Sendable, Equatable {
    public var frame: CGRect
    /// Video pixels per screen point (the backing scale factor, 2 on Retina).
    public var scale: Double

    public init(frame: CGRect, scale: Double) {
        self.frame = frame
        self.scale = scale
    }

    /// Video size in pixels. Rounded to even numbers, which H.264 encoders want.
    public var pixelWidth: Int { Self.evenPixels(frame.width * scale) }
    public var pixelHeight: Int { Self.evenPixels(frame.height * scale) }

    static func evenPixels(_ v: Double) -> Int {
        let n = Int(v.rounded())
        return max(2, n - n % 2)
    }

    /// Global point -> video pixel (origin top-left). Not clamped, may be outside the video.
    public func videoPoint(fromGlobal p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - frame.minX) * scale, y: (p.y - frame.minY) * scale)
    }

    /// True when the global point lies inside the captured area.
    public func contains(global p: CGPoint) -> Bool {
        frame.contains(p)
    }

    /// Same as `videoPoint` but kept inside the video, for cursor samples.
    public func clampedVideoPoint(fromGlobal p: CGPoint) -> CGPoint {
        let v = videoPoint(fromGlobal: p)
        return CGPoint(x: min(max(v.x, 0), Double(pixelWidth)),
                       y: min(max(v.y, 0), Double(pixelHeight)))
    }
}

public enum ScreenSpace {
    /// AppKit global point (bottom-left origin, y up; `NSEvent.mouseLocation`) -> Quartz
    /// global point (top-left origin, y down). `primaryHeight` is the primary display's
    /// height in points (`CGDisplayBounds(CGMainDisplayID()).height`).
    public static func quartz(fromAppKit p: CGPoint, primaryHeight: Double) -> CGPoint {
        CGPoint(x: p.x, y: primaryHeight - p.y)
    }
}
