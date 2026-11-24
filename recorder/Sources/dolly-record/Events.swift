import AppKit
import CoreGraphics
import CoreMedia
import DollyCore

/// Seconds on the host clock: the same clock ScreenCaptureKit uses for frame timestamps.
func hostSeconds() -> Double { CMClockGetTime(CMClockGetHostTimeClock()).seconds }

/// Collects cursor / click / key / scroll events as video-relative data.
/// Everything before the first video frame (`t0`) is dropped, so time 0 is the first frame.
final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var region: CaptureRegion
    private let windowID: CGWindowID?
    private let fps: Int
    private var t0: Double?
    private var cursor: [CursorSample] = []
    private var clicks: [ClickEvent] = []
    private var keys: [KeyEvent] = []
    private var scroll: [ScrollEvent] = []
    private var timer: DispatchSourceTimer?
    fileprivate var tap: CFMachPort?

    init(region: CaptureRegion, windowID: CGWindowID?, fps: Int) {
        self.region = region
        self.windowID = windowID
        self.fps = fps
    }

    /// Called with the first frame's host time. Starts the cursor timer on that grid:
    /// samples fall at t0 + k/fps, one per video frame period.
    func start(t0: Double) {
        lock.lock(); self.t0 = t0; lock.unlock()
        sampleCursor()
        let period = 1.0 / Double(fps)
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "dolly.cursor", qos: .userInteractive))
        let firstDelay = max(0, t0 + period - hostSeconds())
        t.schedule(deadline: .now() + firstDelay, repeating: period, leeway: .microseconds(500))
        t.setEventHandler { [weak self] in self?.sampleCursor() }
        lock.lock(); timer = t; lock.unlock()
        t.resume()
    }

    func stop() {
        lock.lock(); let t = timer; timer = nil; lock.unlock()
        t?.cancel()
    }

    private func ms(_ now: Double) -> Int? {
        guard let t0 else { return nil }
        let v = Int(((now - t0) * 1000).rounded())
        return v < 0 ? nil : v
    }

    private func refreshWindowFrame() {
        guard let id = windowID,
              let infos = CGWindowListCreateDescriptionFromArray([id] as CFArray) as? [[String: Any]],
              let bounds = infos.first?[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds) else { return }
        region.frame = rect   // window moved: keep the cursor relative to it
    }

    fileprivate func sampleCursor() {
        let now = hostSeconds()
        guard let p = CGEvent(source: nil)?.location else { return }
        lock.lock(); defer { lock.unlock() }
        refreshWindowFrame()
        guard let t = ms(now) else { return }
        let v = region.clampedVideoPoint(fromGlobal: p)
        if let last = cursor.last, last.tMs >= t { return }   // keep strictly increasing
        cursor.append(CursorSample(tMs: t, x: v.x, y: v.y))
    }

    fileprivate func handle(_ type: CGEventType, _ event: CGEvent) {
        let now = hostSeconds()
        lock.lock(); defer { lock.unlock() }
        guard let t = ms(now) else { return }
        switch type {
        case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp:
            let p = event.location
            guard region.contains(global: p) else { return }
            let v = region.videoPoint(fromGlobal: p)
            let down = type == .leftMouseDown || type == .rightMouseDown
            let left = type == .leftMouseDown || type == .leftMouseUp
            clicks.append(ClickEvent(tMs: t, x: v.x, y: v.y, button: left ? "left" : "right", kind: down ? "down" : "up"))
        case .scrollWheel:
            let dy = Int(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1))
            if dy != 0 { scroll.append(ScrollEvent(tMs: t, dy: dy)) }
        case .keyDown:
            if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return }
            let f = event.flags
            var mods: Modifiers = []
            if f.contains(.maskCommand) { mods.insert(.cmd) }
            if f.contains(.maskControl) { mods.insert(.ctrl) }
            if f.contains(.maskAlternate) { mods.insert(.alt) }
            if f.contains(.maskShift) { mods.insert(.shift) }
            // Privacy: the character is read only for shortcuts, never for plain typing.
            var label: String?
            if KeyLabel.isShortcut(mods) {
                let char = NSEvent(cgEvent: event)?.charactersIgnoringModifiers
                label = KeyLabel.label(mods: mods, char: char, keyCode: Int(event.getIntegerValueField(.keyboardEventKeycode)))
            }
            keys.append(KeyEvent(tMs: t, mods: mods.names, label: label))
        default: break
        }
    }

    func snapshot(durationMs: Int) -> EventsFile {
        lock.lock(); defer { lock.unlock() }
        return EventsFile(width: region.pixelWidth, height: region.pixelHeight, fps: fps,
                          durationMs: durationMs, pointScale: region.scale,
                          cursor: cursor, clicks: clicks, keys: keys, scroll: scroll)
    }
}

// MARK: - Event tap

private func tapCallback(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
                         _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let refcon else { return Unmanaged.passUnretained(event) }
    let log = Unmanaged<EventLog>.fromOpaque(refcon).takeUnretainedValue()
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = log.tap { CGEvent.tapEnable(tap: tap, enable: true) }
    } else {
        log.handle(type, event)
    }
    return Unmanaged.passUnretained(event)
}

/// Listen-only global tap for mouse buttons, scroll and key-down. Never alters events.
final class EventTap: @unchecked Sendable {
    private var runLoop: CFRunLoop?
    private let log: EventLog

    init(log: EventLog) { self.log = log }

    func start() throws {
        let types: [CGEventType] = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .scrollWheel, .keyDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let refcon = Unmanaged.passUnretained(log).toOpaque()
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                          options: .listenOnly, eventsOfInterest: mask,
                                          callback: tapCallback, userInfo: refcon) else {
            throw Fail("Cannot listen for mouse and key events: \(Permissions.accessibilityHint) (Input Monitoring may also be needed)")
        }
        log.tap = tap
        let ready = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var rl: CFRunLoop?
        nonisolated(unsafe) let port = tap
        let thread = Thread {
            rl = CFRunLoopGetCurrent()
            let source = CFMachPortCreateRunLoopSource(nil, port, 0)
            CFRunLoopAddSource(rl, source, .commonModes)
            CGEvent.tapEnable(tap: port, enable: true)
            ready.signal()
            CFRunLoopRun()
        }
        thread.name = "dolly.eventtap"
        thread.start()
        ready.wait()
        runLoop = rl
    }

    func stop() {
        if let tap = log.tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let rl = runLoop { CFRunLoopStop(rl) }
    }
}
