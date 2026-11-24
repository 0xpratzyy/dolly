import AVFoundation
import VideoToolbox

/// AVAssetWriter on the VideoToolbox hardware encoder: H.264 High or HEVC, moov at the front (faststart), optional AAC voice.
final class Encoder {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private var audioIn: AVAssetWriterInput?
    private var audioReader: AVAssetReader?
    private var audioOut: AVAssetReaderOutput?
    private let audioDone = DispatchSemaphore(value: 0)
    private let timescale: CMTimeScale
    private let fps: Double
    var waitSeconds = 0.0

    struct Options {
        var hevc = false
        /// Constant quality 0..1 (the default mode), or an average bitrate in bits/s when set.
        var quality = 0.72
        var bitrate: Int?
    }

    init(url: URL, width: Int, height: Int, fps: Double, frames: Int, opt: Options, audio: Spec.Audio?) async throws {
        try? FileManager.default.removeItem(at: url)
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.shouldOptimizeForNetworkUse = true
        self.fps = fps
        timescale = abs(fps - fps.rounded()) < 1e-6 ? CMTimeScale(fps.rounded()) : 60000
        var comp: [String: Any] = [
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalDurationKey: 2.0,
            AVVideoAllowFrameReorderingKey: true,
        ]
        if !opt.hevc { comp[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel; comp[AVVideoH264EntropyModeKey] = AVVideoH264EntropyModeCABAC }
        if let b = opt.bitrate { comp[AVVideoAverageBitRateKey] = b } else { comp[AVVideoQualityKey] = opt.quality }
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: opt.hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
            ],
            AVVideoEncoderSpecificationKey: [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String: true],
            AVVideoCompressionPropertiesKey: comp,
        ])
        input.expectsMediaDataInRealTime = false
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ])
        guard writer.canAdd(input) else { throw Fail("the encoder does not accept \(width)x\(height) \(opt.hevc ? "HEVC" : "H.264")") }
        writer.add(input)

        // the voice: decoded, its volume and the short fade at the end applied, encoded as AAC next to the picture
        if let a = audio {
            let asset = AVURLAsset(url: URL(fileURLWithPath: a.path))
            let tracks = try await asset.loadTracks(withMediaType: .audio)
            if !tracks.isEmpty {
                let dur = CMTime(value: CMTimeValue(frames), timescale: timescale)
                let r = try AVAssetReader(asset: asset)
                r.timeRange = CMTimeRange(start: .zero, duration: dur)
                let mixOut = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false])
                let mix = AVMutableAudioMix()
                mix.inputParameters = tracks.map { t in
                    let p = AVMutableAudioMixInputParameters(track: t)
                    p.setVolume(Float(a.volume), at: .zero)
                    let fade = CMTime(value: CMTimeValue(a.fadeOutFrames), timescale: timescale)
                    p.setVolumeRamp(fromStartVolume: Float(a.volume), toEndVolume: 0, timeRange: CMTimeRange(start: CMTimeSubtract(dur, fade), duration: fade))
                    return p
                }
                mixOut.audioMix = mix
                r.add(mixOut)
                let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 2, AVSampleRateKey: 48000, AVEncoderBitRateKey: 192_000])
                ai.expectsMediaDataInRealTime = false
                if writer.canAdd(ai) { writer.add(ai); audioIn = ai; audioReader = r; audioOut = mixOut }
            }
        }
        guard writer.startWriting() else { throw Fail("cannot write \(url.path): \(writer.error?.localizedDescription ?? "unknown error")") }
        writer.startSession(atSourceTime: .zero)
        if let ai = audioIn, let r = audioReader, let out = audioOut {
            r.startReading()
            ai.requestMediaDataWhenReady(on: DispatchQueue(label: "dolly.audio")) { [audioDone] in
                while ai.isReadyForMoreMediaData {
                    guard let sb = out.copyNextSampleBuffer() else { ai.markAsFinished(); audioDone.signal(); return }
                    if !ai.append(sb) { ai.markAsFinished(); audioDone.signal(); return }
                }
            }
        }
    }

    func newBuffer() throws -> CVPixelBuffer {
        guard let pool = adaptor.pixelBufferPool else { throw Fail("the encoder has no buffer pool: \(writer.error?.localizedDescription ?? "not started")") }
        var pb: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
        guard let pb else { throw Fail("cannot get an output buffer") }
        return pb
    }

    /// Hands frame `i` to the encoder, waiting while it is busy (this is the back-pressure that keeps the pipeline short).
    func append(_ pb: CVPixelBuffer, frame i: Int) throws {
        let t0 = CFAbsoluteTimeGetCurrent()
        while !input.isReadyForMoreMediaData {
            if writer.status != .writing { throw Fail("encoding failed: \(writer.error?.localizedDescription ?? "unknown error")") }
            usleep(300)
        }
        waitSeconds += CFAbsoluteTimeGetCurrent() - t0
        let pts = timescale == 60000 ? CMTime(value: CMTimeValue((Double(i) * 60000 / fps).rounded()), timescale: 60000) : CMTime(value: CMTimeValue(i), timescale: timescale)
        if !adaptor.append(pb, withPresentationTime: pts) { throw Fail("encoding failed: \(writer.error?.localizedDescription ?? "unknown error")") }
    }

    func finish(frames: Int) async throws {
        input.markAsFinished()
        if audioIn != nil { await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in DispatchQueue.global().async { [audioDone] in audioDone.wait(); c.resume() } } }
        writer.endSession(atSourceTime: timescale == 60000 ? CMTime(value: CMTimeValue((Double(frames) * 60000 / fps).rounded()), timescale: 60000) : CMTime(value: CMTimeValue(frames), timescale: timescale))
        await writer.finishWriting()
        if writer.status != .completed { throw Fail("encoding failed: \(writer.error?.localizedDescription ?? "unknown error")") }
    }
}
