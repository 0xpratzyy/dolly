import AVFoundation
import CoreImage

/// Decodes the recording in order on the hardware decoder and hands out the picture for any source time, going forwards.
/// Frames sit at their real presentation times (variable frame rate is fine): the nearest frame is shown, and only when the
/// gap between two neighbours is longer than 1.5 output frames (a dropped frame) are the two blended across it.
final class FrameSource {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    private var queue: [(ms: Double, pb: CVPixelBuffer)] = []
    /// Frames before this are not the recording: an empty edit at the start of the file plays as a black frame.
    private var skipBefore = CMTime.zero
    private var eof = false
    private let frameMs: Double
    private(set) var decoded = 0
    private(set) var blended = 0
    var decodeSeconds = 0.0

    init(url: URL, outputFps: Double) async throws {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Fail("no video track in \(url.path)") }
        reader = try AVAssetReader(asset: asset)
        if let segs = try? await track.load(.segments) {
            for seg in segs { if seg.isEmpty { skipBefore = CMTimeRangeGetEnd(seg.timeMapping.target) } else { break } }
        }
        output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        guard reader.startReading() else { throw Fail("cannot read \(url.path): \(reader.error?.localizedDescription ?? "unknown error")") }
        frameMs = 1000 / outputFps
    }

    private func readOne() {
        let t0 = CFAbsoluteTimeGetCurrent()
        defer { decodeSeconds += CFAbsoluteTimeGetCurrent() - t0 }
        while true {
            guard let sb = output.copyNextSampleBuffer() else { eof = true; return }
            guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue } // a marker-only buffer
            let pts = CMSampleBufferGetPresentationTimeStamp(sb)
            if CMTimeCompare(pts, skipBefore) < 0 { continue }
            // file time, as Remotion reads it (an empty edit at the start delays the first frame; it is shown from 0)
            queue.append((CMTimeGetSeconds(pts) * 1000, pb))
            decoded += 1
            return
        }
    }

    /// The picture at source time `t` (ms of file time). `drop`: frames before it are not needed again.
    func image(at t: Double, drop: Bool) -> CIImage? {
        while !eof && (queue.isEmpty || queue[queue.count - 1].ms <= t) { readOne() }
        guard !queue.isEmpty else { return nil }
        var i = 0
        while i + 1 < queue.count && queue[i + 1].ms <= t + 0.01 { i += 1 }
        if drop && i > 0 { queue.removeFirst(i); i = 0 }
        let a = queue[i]
        let ia = CIImage(cvPixelBuffer: a.pb, options: [.colorSpace: NSNull()])
        guard i + 1 < queue.count else { return ia }
        let b = queue[i + 1]
        let gap = b.ms - a.ms, w = (t - a.ms) / max(1e-6, gap)
        if gap > 1.5 * frameMs {
            if w < 0.02 { return ia }
            let ib = CIImage(cvPixelBuffer: b.pb, options: [.colorSpace: NSNull()])
            if w > 0.98 { return ib }
            blended += 1
            return ia.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": ib, "inputTime": w])
        }
        return w > 0.5 ? CIImage(cvPixelBuffer: b.pb, options: [.colorSpace: NSNull()]) : ia
    }

    func cancel() { reader.cancelReading() }
}
