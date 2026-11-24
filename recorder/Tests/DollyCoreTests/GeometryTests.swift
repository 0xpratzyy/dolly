import XCTest
import CoreGraphics
@testable import DollyCore

final class GeometryTests: XCTestCase {
    // Retina primary: 1440x900 points, 2880x1800 px.
    let primary = CaptureRegion(frame: CGRect(x: 0, y: 0, width: 1440, height: 900), scale: 2)

    func testPrimaryDisplayCorners() {
        XCTAssertEqual(primary.pixelWidth, 2880)
        XCTAssertEqual(primary.pixelHeight, 1800)
        XCTAssertEqual(primary.videoPoint(fromGlobal: CGPoint(x: 0, y: 0)), CGPoint(x: 0, y: 0))
        XCTAssertEqual(primary.videoPoint(fromGlobal: CGPoint(x: 720, y: 450)), CGPoint(x: 1440, y: 900))
        XCTAssertEqual(primary.videoPoint(fromGlobal: CGPoint(x: 1440, y: 900)), CGPoint(x: 2880, y: 1800))
    }

    func testSecondaryDisplayLeftOfPrimaryHasNegativeOrigin() {
        // 1920x1080 non-retina external to the left, top-aligned with primary.
        let ext = CaptureRegion(frame: CGRect(x: -1920, y: 0, width: 1920, height: 1080), scale: 1)
        XCTAssertEqual(ext.videoPoint(fromGlobal: CGPoint(x: -1920, y: 0)), CGPoint(x: 0, y: 0))
        XCTAssertEqual(ext.videoPoint(fromGlobal: CGPoint(x: -960, y: 540)), CGPoint(x: 960, y: 540))
        XCTAssertTrue(ext.contains(global: CGPoint(x: -1, y: 10)))
        XCTAssertFalse(ext.contains(global: CGPoint(x: 0, y: 10)))   // that's the primary
        // The primary's own region does not claim the external's points.
        XCTAssertFalse(primary.contains(global: CGPoint(x: -100, y: 100)))
    }

    func testSecondaryDisplayAbovePrimaryHasNegativeY() {
        let above = CaptureRegion(frame: CGRect(x: 100, y: -900, width: 1440, height: 900), scale: 2)
        XCTAssertEqual(above.videoPoint(fromGlobal: CGPoint(x: 100, y: -900)), CGPoint(x: 0, y: 0))
        XCTAssertEqual(above.videoPoint(fromGlobal: CGPoint(x: 200, y: -450)), CGPoint(x: 200, y: 900))
    }

    func testWindowSubtractsItsOriginThenScales() {
        let win = CaptureRegion(frame: CGRect(x: 300, y: 200, width: 800, height: 600), scale: 2)
        XCTAssertEqual(win.pixelWidth, 1600)
        XCTAssertEqual(win.pixelHeight, 1200)
        XCTAssertEqual(win.videoPoint(fromGlobal: CGPoint(x: 300, y: 200)), CGPoint(x: 0, y: 0))
        XCTAssertEqual(win.videoPoint(fromGlobal: CGPoint(x: 350, y: 260)), CGPoint(x: 100, y: 120))
        XCTAssertTrue(win.contains(global: CGPoint(x: 1099, y: 799)))
        XCTAssertFalse(win.contains(global: CGPoint(x: 1100, y: 800)))
    }

    func testWindowOnSecondaryDisplay() {
        let win = CaptureRegion(frame: CGRect(x: -1500, y: 100, width: 600, height: 400), scale: 1)
        XCTAssertEqual(win.videoPoint(fromGlobal: CGPoint(x: -1400, y: 150)), CGPoint(x: 100, y: 50))
    }

    func testCursorClampedToVideo() {
        let c = primary.clampedVideoPoint(fromGlobal: CGPoint(x: -50, y: 2000))
        XCTAssertEqual(c, CGPoint(x: 0, y: 1800))
        // Unclamped version keeps the true position.
        XCTAssertEqual(primary.videoPoint(fromGlobal: CGPoint(x: -50, y: 2000)), CGPoint(x: -100, y: 4000))
    }

    func testPixelSizeIsEven() {
        let odd = CaptureRegion(frame: CGRect(x: 0, y: 0, width: 801, height: 601), scale: 1)
        XCTAssertEqual(odd.pixelWidth, 800)
        XCTAssertEqual(odd.pixelHeight, 600)
        let fractional = CaptureRegion(frame: CGRect(x: 0, y: 0, width: 1512, height: 982), scale: 2)
        XCTAssertEqual(fractional.pixelWidth, 3024)
        XCTAssertEqual(fractional.pixelHeight, 1964)
    }

    func testAppKitToQuartz() {
        // Primary is 900 pt tall. AppKit (0,0) is bottom-left; Quartz (0,0) is top-left.
        XCTAssertEqual(ScreenSpace.quartz(fromAppKit: CGPoint(x: 10, y: 0), primaryHeight: 900), CGPoint(x: 10, y: 900))
        XCTAssertEqual(ScreenSpace.quartz(fromAppKit: CGPoint(x: 10, y: 900), primaryHeight: 900), CGPoint(x: 10, y: 0))
        // A display above the primary has AppKit y > primaryHeight, i.e. negative Quartz y.
        XCTAssertEqual(ScreenSpace.quartz(fromAppKit: CGPoint(x: 0, y: 1000), primaryHeight: 900), CGPoint(x: 0, y: -100))
    }
}

final class EventsFileTests: XCTestCase {
    func testPlainTypingHasNoLabel() {
        XCTAssertNil(KeyLabel.label(mods: [], char: "a", keyCode: 0))
        XCTAssertNil(KeyLabel.label(mods: [.shift], char: "A", keyCode: 0))
    }

    func testShortcutLabels() {
        XCTAssertEqual(KeyLabel.label(mods: [.cmd], char: "k", keyCode: 40), "⌘K")
        XCTAssertEqual(KeyLabel.label(mods: [.cmd, .shift], char: "p", keyCode: 35), "⌘⇧P")
        XCTAssertEqual(KeyLabel.label(mods: [.ctrl, .alt], char: nil, keyCode: 123), "⌃⌥←")
        XCTAssertEqual(KeyLabel.label(mods: [.cmd], char: "\u{F702}", keyCode: 200), "⌘")  // private-use function key: no char
    }

    func testModNames() {
        XCTAssertEqual(Modifiers([.cmd, .shift]).names, ["cmd", "shift"])
        XCTAssertEqual(Modifiers([]).names, [])
    }

    func testJSONMatchesContractShape() throws {
        let f = EventsFile(width: 2880, height: 1800, fps: 60, durationMs: 41250, pointScale: 2,
                           cursor: [CursorSample(tMs: 0, x: 1440, y: 900), CursorSample(tMs: 16, x: 1442.5, y: 901)],
                           clicks: [ClickEvent(tMs: 2310, x: 812, y: 403, button: "left", kind: "down")],
                           keys: [KeyEvent(tMs: 5120, mods: [], label: nil), KeyEvent(tMs: 9000, mods: ["cmd"], label: "⌘K")],
                           scroll: [ScrollEvent(tMs: 7000, dy: -120)])
        let obj = try JSONSerialization.jsonObject(with: f.jsonData()) as! [String: Any]
        XCTAssertEqual(obj["version"] as? Int, 1)
        XCTAssertEqual(obj["video"] as? String, "recording.mov")
        XCTAssertEqual(obj["width"] as? Int, 2880)
        XCTAssertEqual(obj["pointScale"] as? Double, 2)
        XCTAssertEqual(obj["cursor"] as? [[Double]], [[0, 1440, 900], [16, 1442.5, 901]])
        let keys = obj["keys"] as! [[String: Any]]
        XCTAssertNil(keys[0]["label"])            // plain typing: no label key at all
        XCTAssertEqual(keys[1]["label"] as? String, "⌘K")
        let click = (obj["clicks"] as! [[String: Any]])[0]
        XCTAssertEqual(click["kind"] as? String, "down")
        XCTAssertEqual((obj["scroll"] as! [[String: Any]])[0]["dy"] as? Int, -120)
    }
}
