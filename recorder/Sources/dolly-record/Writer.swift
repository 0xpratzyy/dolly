import AVFoundation
import DollyCore

/// Writes recording.mov. Not thread-safe: the Recorder calls it from one serial queue only.
final class Writer: @unchecked Sendable {
    private let writer: AVAssetWriter
    private let video: AVAssetWriterInput
    private let audio: AVAssetWriterInput?
    private(set) var started = false
    private(set) var droppedFrames = 0

    init(url: URL, width: Int, height: Int, fps: Int, mic: Bool) throws {
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        // ~0.1 bit per pixel per frame, between 8 and 80 Mbit/s: crisp UI text without huge files.
        let bitrate = min(max(Double(width * height * fps) * 0.1, 8e6), 80e6)
        video = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: Int(bitrate),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
                AVVideoAllowFrameReorderingKey: false,
            ] as [String: Any],
        ])
        video.expectsMediaDataInRealTime = true
        writer.add(video)
        if mic {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVNumberOfChannelsKey: 1,
                AVSampleRateKey: 48000,
                AVEncoderBitRateKey: 128_000,
            ])
            a.expectsMediaDataInRealTime = true
            writer.add(a)
            audio = a
        } else {
            audio = nil
        }
    }

    /// Starts the file at the first video frame's timestamp, so media time 0 == first frame.
    func start(at t0: CMTime) throws {
        guard writer.startWriting() else {
            throw Fail("Cannot write recording.mov: \(writer.error?.localizedDescription ?? "unknown error")")
        }
        writer.startSession(atSourceTime: t0)
        started = true
    }

    func appendVideo(_ sb: CMSampleBuffer) {
        guard started, writer.status == .writing else { return }
        if video.isReadyForMoreMediaData { video.append(sb) } else { droppedFrames += 1 }
    }

    func appendAudio(_ sb: CMSampleBuffer, notBefore t0: CMTime) {
        guard started, writer.status == .writing, let audio, audio.isReadyForMoreMediaData else { return }
        guard CMSampleBufferGetPresentationTimeStamp(sb) >= t0 else { return }
        audio.append(sb)
    }

    /// Closes the file at `end`. Throws if the writer failed or nothing was ever written.
    func finish(endingAt end: CMTime) async throws {
        guard started else {
            writer.cancelWriting()
            throw Fail("No video frames arrived from the screen, nothing was recorded")
        }
        video.markAsFinished()
        audio?.markAsFinished()
        writer.endSession(atSourceTime: end)
        await writer.finishWriting()
        if writer.status != .completed {
            throw Fail("Finalising recording.mov failed: \(writer.error?.localizedDescription ?? "unknown error")")
        }
    }
}
