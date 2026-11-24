import AppKit
import CoreGraphics
import DollyCore
import Foundation
@preconcurrency import ScreenCaptureKit

func die(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("dolly-record: \(message)\n".utf8))
    exit(code)
}

/// One-shot "please stop" signal shared by Ctrl-C, --duration and stream errors.
final class StopSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var reason: String?
    private var waiter: CheckedContinuation<String, Never>?
    func trigger(_ r: String) {
        lock.lock(); defer { lock.unlock() }
        guard reason == nil else { return }
        reason = r
        waiter?.resume(returning: r); waiter = nil
    }
    func wait() async -> String {
        await withCheckedContinuation { c in
            lock.lock(); defer { lock.unlock() }
            if let reason { c.resume(returning: reason) } else { waiter = c }
        }
    }
}

func listTargets() async {
    print("Displays (id, size in points, pixel scale):")
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    var n: UInt32 = 0
    CGGetActiveDisplayList(16, &ids, &n)
    for id in ids.prefix(Int(n)) {
        let b = CGDisplayBounds(id)
        let scale = CGDisplayCopyDisplayMode(id).map { Double($0.pixelWidth) / Double($0.width) } ?? 1
        print("  \(id)  \(Int(b.width))x\(Int(b.height))  @\(scale)x  origin (\(Int(b.minX)), \(Int(b.minY)))\(id == CGMainDisplayID() ? "  [main]" : "")")
    }
    guard Permissions.screenRecording else {
        print("\nWindows are hidden until Screen Recording is granted: \(Permissions.screenHint)")
        exit(1)
    }
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        print("\nWindows (id, size in points, app, title):")
        for w in content.windows where w.windowLayer == 0 && w.frame.width >= 50 && w.frame.height >= 50 {
            print("  \(w.windowID)  \(Int(w.frame.width))x\(Int(w.frame.height))  \(w.owningApplication?.applicationName ?? "?")  \"\(w.title ?? "")\"")
        }
    } catch {
        die("cannot list windows: \(Permissions.screenHint)")
    }
}

func record(_ o: Options) async throws {
    guard let outPath = o.out else { die("--out <dir> is required (see --help)") }
    // Fail fast: check permissions before touching anything.
    guard Permissions.screenRecording else { die("Screen Recording permission is missing: \(Permissions.screenHint) (dolly-record --check)") }
    guard Permissions.accessibility else { die("Accessibility permission is missing: \(Permissions.accessibilityHint) (dolly-record --check)") }
    if o.mic { try await Permissions.requireMicrophone() }

    let dir = URL(fileURLWithPath: (outPath as NSString).expandingTildeInPath, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let target = try await resolveTarget(display: o.display, window: o.window)
    let region = target.region
    let writer = try Writer(url: dir.appendingPathComponent("recording.mov"),
                            width: region.pixelWidth, height: region.pixelHeight, fps: o.fps, mic: o.mic)
    let log = EventLog(region: region, windowID: target.windowID, fps: o.fps)
    let stop = StopSignal()

    signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
    let sources = [SIGINT, SIGTERM].map { sig -> DispatchSourceSignal in
        let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        s.setEventHandler { stop.trigger("interrupted") }
        s.resume()
        return s
    }
    defer { sources.forEach { $0.cancel() } }

    let firstFrame = FirstFrameFlag()
    let recorder = Recorder(writer: writer, log: log,
                            onFirstFrame: { firstFrame.set() },
                            onError: { stop.trigger("error: \($0)") })

    FileHandle.standardError.write(Data("Recording \(target.name): \(region.pixelWidth)x\(region.pixelHeight) px @ \(o.fps) fps\n".utf8))
    if o.countdown > 0 {
        for n in stride(from: o.countdown, through: 1, by: -1) {
            FileHandle.standardError.write(Data("  \(n)…\n".utf8))
            try await Task.sleep(for: .seconds(1))
        }
    }
    try await recorder.start(target: target, fps: o.fps, mic: o.mic)

    let watchdog = Task {   // never hang waiting for a first frame
        try await Task.sleep(for: .seconds(10))
        if !firstFrame.isSet { stop.trigger("error: no video frames arrived within 10 s. \(Permissions.screenHint)") }
    }
    let timer = o.duration.map { d in
        Task { try await Task.sleep(for: .seconds(d)); stop.trigger("duration reached") }
    }
    FileHandle.standardError.write(Data("● Recording. Press Ctrl-C to stop.\n".utf8))
    let reason = await stop.wait()
    watchdog.cancel(); timer?.cancel()
    signal(SIGINT, SIG_DFL)   // a second Ctrl-C while finalising kills us
    FileHandle.standardError.write(Data("Stopping (\(reason)), finalising…\n".utf8))

    let events = try await recorder.finish()
    try events.jsonData().write(to: dir.appendingPathComponent("events.json"), options: .atomic)
    print("Saved \(dir.path)/recording.mov and events.json: \(events.width)x\(events.height), \(Double(events.durationMs) / 1000) s, "
          + "\(events.cursor.count) cursor samples, \(events.clicks.count) clicks, \(events.keys.count) keys, \(events.scroll.count) scrolls")
    if writer.droppedFrames > 0 { print("Note: \(writer.droppedFrames) frames were dropped by the encoder (disk or CPU too slow)") }
    if reason.hasPrefix("error:") { die(String(reason.dropFirst(7)), code: 2) }
}

final class FirstFrameFlag: @unchecked Sendable {
    private let lock = NSLock(); private var v = false
    func set() { lock.lock(); v = true; lock.unlock() }
    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return v }
}

// MARK: entry

// Window capture (SCContentFilter for one window) needs a window-server connection; a plain CLI has none until
// AppKit is touched, and it aborts with CGS_REQUIRE_INIT. Display capture happened to work without it.
_ = NSApplication.shared

let options: Options
do { options = try Options.parse(Array(CommandLine.arguments.dropFirst())) }
catch { die("\(error). Try dolly-record --help", code: 64) }

if options.help { print(usage); exit(0) }
if options.check { exit(Permissions.printCheck() ? 0 : 1) }
if options.list { await listTargets(); exit(0) }
do { try await record(options) } catch { die("\(error)") }
