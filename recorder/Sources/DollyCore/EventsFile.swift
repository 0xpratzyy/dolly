import Foundation

// The events.json contract (version 1). See ~/code/dolly/CONTRACT.md.
// Times are ms from the first video frame, coordinates are video pixels, top-left origin.

public struct CursorSample: Encodable, Equatable, Sendable {
    public var tMs: Int
    public var x: Double
    public var y: Double
    public init(tMs: Int, x: Double, y: Double) { self.tMs = tMs; self.x = x; self.y = y }
    /// Encoded as the compact triple [tMs, x, y].
    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(tMs)
        try c.encode(Self.r2(x))
        try c.encode(Self.r2(y))
    }
    static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
}

public struct ClickEvent: Encodable, Equatable, Sendable {
    public var tMs: Int
    public var x: Double
    public var y: Double
    public var button: String   // "left" | "right"
    public var kind: String     // "down" | "up"
    public init(tMs: Int, x: Double, y: Double, button: String, kind: String) {
        self.tMs = tMs; self.x = CursorSample.r2(x); self.y = CursorSample.r2(y)
        self.button = button; self.kind = kind
    }
}

/// Privacy: never holds typed characters. `label` exists only for shortcuts with a modifier.
public struct KeyEvent: Encodable, Equatable, Sendable {
    public var tMs: Int
    public var mods: [String]   // subset of cmd, ctrl, alt, shift
    public var label: String?
    public init(tMs: Int, mods: [String], label: String?) { self.tMs = tMs; self.mods = mods; self.label = label }
}

public struct ScrollEvent: Encodable, Equatable, Sendable {
    public var tMs: Int
    public var dy: Int
    public init(tMs: Int, dy: Int) { self.tMs = tMs; self.dy = dy }
}

public struct EventsFile: Encodable, Sendable {
    public var version = 1
    public var video = "recording.mov"
    public var width: Int
    public var height: Int
    public var fps: Int
    public var durationMs: Int
    public var pointScale: Double
    public var cursor: [CursorSample]
    public var clicks: [ClickEvent]
    public var keys: [KeyEvent]
    public var scroll: [ScrollEvent]

    public init(width: Int, height: Int, fps: Int, durationMs: Int, pointScale: Double,
                cursor: [CursorSample], clicks: [ClickEvent], keys: [KeyEvent], scroll: [ScrollEvent]) {
        self.width = width; self.height = height; self.fps = fps; self.durationMs = durationMs
        self.pointScale = pointScale; self.cursor = cursor; self.clicks = clicks
        self.keys = keys; self.scroll = scroll
    }

    public func jsonData() throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try enc.encode(self)
    }
}

// MARK: - Keys

public struct Modifiers: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let cmd = Modifiers(rawValue: 1)
    public static let ctrl = Modifiers(rawValue: 2)
    public static let alt = Modifiers(rawValue: 4)
    public static let shift = Modifiers(rawValue: 8)

    /// Names for the `mods` array, in a fixed order.
    public var names: [String] {
        var out: [String] = []
        if contains(.cmd) { out.append("cmd") }
        if contains(.ctrl) { out.append("ctrl") }
        if contains(.alt) { out.append("alt") }
        if contains(.shift) { out.append("shift") }
        return out
    }
}

public enum KeyLabel {
    /// True when a label may be written: only shortcuts (cmd, ctrl or alt held). Shift alone
    /// is plain typing. Callers must not even read the key's character when this is false.
    public static func isShortcut(_ mods: Modifiers) -> Bool {
        !mods.isDisjoint(with: [.cmd, .ctrl, .alt])
    }

    /// "⌘K", "⌘⇧P", "⌃⌥←". `char` is the key's character ignoring modifiers (only passed
    /// for shortcuts); special keys are named by `keyCode`.
    public static func label(mods: Modifiers, char: String?, keyCode: Int) -> String? {
        guard isShortcut(mods) else { return nil }
        var s = ""
        if mods.contains(.cmd) { s += "⌘" }
        if mods.contains(.ctrl) { s += "⌃" }
        if mods.contains(.alt) { s += "⌥" }
        if mods.contains(.shift) { s += "⇧" }
        if let special = specialKeys[keyCode] {
            s += special
        } else if let c = char?.uppercased(), let u = c.unicodeScalars.first,
                  !c.isEmpty, u.value >= 0x20, !(0xF700...0xF8FF).contains(u.value) {
            s += c
        }
        return s
    }

    static let specialKeys: [Int: String] = [
        36: "↩", 48: "⇥", 49: "Space", 51: "⌫", 53: "⎋", 117: "⌦",
        123: "←", 124: "→", 125: "↓", 126: "↑",
        115: "↖", 119: "↘", 116: "⇞", 121: "⇟",
    ]
}
