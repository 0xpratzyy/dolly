import AVFoundation
import DollyCore
@preconcurrency import ScreenCaptureKit

struct Target {
    let filter: SCContentFilter
    let region: CaptureRegion
    let windowID: CGWindowID?
    let name: String
}

/// Picks the display (or window) to record from what ScreenCaptureKit can see.
func resolveTarget(display: String, window: String?) async throws -> Target {
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    } catch {
        throw Fail("Cannot read the screen: \(Permissions.screenHint)")
    }
    if let query = window {
        let matches = content.windows.filter {
            String($0.windowID) == query  // an id from --list
            || $0.windowLayer == 0 && $0.isOnScreen && $0.frame.width >= 50 && $0.frame.height >= 50
                && (($0.title ?? "").localizedCaseInsensitiveContains(query)
                    || ($0.owningApplication?.applicationName ?? "").localizedCaseInsensitiveContains(query))
        }
        guard let w = matches.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
            throw Fail("No on-screen window matches \"\(query)\". Run dolly-record --list to see windows")
        }
        let filter = SCContentFilter(desktopIndependentWindow: w)
        let region = CaptureRegion(frame: w.frame, scale: Double(filter.pointPixelScale))
        return Target(filter: filter, region: region, windowID: w.windowID,
                      name: "window \"\(w.title ?? "")\" (\(w.owningApplication?.applicationName ?? "?"))")
    }
    let id: CGDirectDisplayID
    if display == "main" { id = CGMainDisplayID() }
    else if let n = UInt32(display) { id = n }
    else { throw Fail("--display must be 'main' or a display id from --list") }
    guard let d = content.displays.first(where: { $0.displayID == id }) else {
        throw Fail("Display \(display) not found. Run dolly-record --list")
    }
    let filter = SCContentFilter(display: d, excludingWindows: [])
    let region = CaptureRegion(frame: d.frame, scale: Double(filter.pointPixelScale))
    return Target(filter: filter, region: region, windowID: nil, name: "display \(d.displayID)")
}

/// Owns the stream, the file writer and the event log, and keeps their clocks aligned:
/// media time 0 and event time 0 are both the first complete video frame.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "dolly.capture")   // video, audio and writer all run here
    private let writer: Writer
    private let log: EventLog
    private let tap: EventTap
    private var stream: SCStream?
    private var micSession: AVCaptureSession?
    private var t0: CMTime?
    private var lastPTS: CMTime = .zero
    private var stopped = false
    private let onFirstFrame: @Sendable () -> Void
    private let onError: @Sendable (String) -> Void

    init(writer: Writer, log: EventLog, onFirstFrame: @escaping @Sendable () -> Void, onError: @escaping @Sendable (String) -> Void) {
        self.writer = writer; self.log = log; self.tap = EventTap(log: log)
        self.onFirstFrame = onFirstFrame; self.onError = onError
    }

    func start(target: Target, fps: Int, mic: Bool) async throws {
        try tap.start()   // before the stream, so no early click is missed (dropped until t0 anyway)
        let cfg = SCStreamConfiguration()
        cfg.width = target.region.pixelWidth
        cfg.height = target.region.pixelHeight
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        cfg.showsCursor = false
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.queueDepth = 6
        cfg.ignoreShadowsSingleWindow = true   // window frame == captured image, so cursor math lines up
        let s = SCStream(filter: target.filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        stream = s
        if mic { try startMic() }
        try await s.startCapture()
    }

    private func startMic() throws {
        guard let device = AVCaptureDevice.default(for: .audio) else { throw Fail("No microphone found") }
        let session = AVCaptureSession()
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        guard session.canAddInput(input), session.canAddOutput(output) else { throw Fail("Cannot capture the microphone") }
        session.addInput(input)
        session.addOutput(output)
        output.setSampleBufferDelegate(self, queue: queue)
        session.startRunning()
        micSession = session
    }

    // MARK: sample handlers (on `queue`)

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !stopped, sb.isValid, isCompleteFrame(sb) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        if t0 == nil {
            do { try writer.start(at: pts) } catch { onError("\(error)"); stopped = true; return }
            t0 = pts
            log.start(t0: pts.seconds)
            onFirstFrame()
        }
        lastPTS = pts
        writer.appendVideo(sb)
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !stopped, let t0 else { return }
        writer.appendAudio(sb, notBefore: t0)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError("The screen stream stopped: \(error.localizedDescription)")
    }

    /// SCK also sends idle/blank status buffers with no pixels; only `.complete` frames count.
    private func isCompleteFrame(_ sb: CMSampleBuffer) -> Bool {
        guard let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = arr.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw) else { return false }
        return status == .complete
    }

    // MARK: stop

    /// Stops capture, closes recording.mov and returns the events with the final duration.
    func finish() async throws -> EventsFile {
        micSession?.stopRunning()
        try? await stream?.stopCapture()
        tap.stop()
        log.stop()
        let (t0, end): (CMTime?, CMTime) = await withCheckedContinuation { c in
            queue.async {
                self.stopped = true
                // End at the stop moment (not the last frame): SCK sends no frames for a still screen.
                let now = CMClockGetTime(CMClockGetHostTimeClock())
                c.resume(returning: (self.t0, max(now, self.lastPTS)))
            }
        }
        try await writer.finish(endingAt: end)
        guard let t0 else { throw Fail("No video frames arrived") }
        let ms = Int(((end - t0).seconds * 1000).rounded())
        return log.snapshot(durationMs: ms)
    }
}
