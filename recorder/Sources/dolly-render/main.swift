import AVFoundation
import CoreImage
import Foundation

// dolly-render: the native renderer. Hardware decode (VideoToolbox) -> composite on the GPU (Core Image on Metal) ->
// hardware encode (VideoToolbox), one frame at a time, so it stays cool and small in memory.
//
//   dolly-render --spec spec.json --out out.mp4 [--codec h264|hevc] [--quality 0..1 | --bitrate <Mbit/s>] [--stats]
//   dolly-render <recording-dir> [--style <preset|file.json>] [--set a.b=v ...] [--captions file.json] [--audio voice.m4a]
//                [--fps n] --out out.mp4 ...        (runs studio/scripts/camera-track.mjs with node to make the spec)
//
// The spec holds the per-frame camera and cursor track computed by the studio (studio/src/camera.ts), so this renderer and
// the Remotion one move the camera identically.

func fail(_ m: String) -> Never { FileHandle.standardError.write(Data((m + "\n").utf8)); exit(1) }

var args = Array(CommandLine.arguments.dropFirst())
var flags: [String: String] = [:], passthrough: [String] = [], positional: [String] = []
let own: Set<String> = ["spec", "out", "codec", "quality", "bitrate", "stats", "frames"]
var i = 0
while i < args.count {
    let a = args[i]
    if a.hasPrefix("--") {
        let name = String(a.dropFirst(2))
        let hasValue = i + 1 < args.count && !args[i + 1].hasPrefix("--")
        if own.contains(name) { flags[name] = hasValue ? args[i + 1] : "true" } else { passthrough.append(a); if hasValue { passthrough.append(args[i + 1]) } }
        i += hasValue ? 2 : 1
    } else { positional.append(a); i += 1 }
}
if flags["spec"] == nil && positional.isEmpty {
    fail("usage: dolly-render --spec spec.json --out out.mp4 [--codec h264|hevc] [--quality 0..1 | --bitrate Mbit/s] [--stats]\n       dolly-render <recording-dir> [--style ...] [--set a.b=v] [--captions f.json] --out out.mp4")
}

/// studio/scripts/camera-track.mjs: $DOLLY_STUDIO, or the studio folder next to the recorder this binary was built in.
func studioScript() -> String? {
    var roots: [String] = []
    if let s = ProcessInfo.processInfo.environment["DOLLY_STUDIO"] { roots.append(s) }
    var d = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
    for _ in 0..<6 { roots.append(d.appendingPathComponent("studio").path); d = d.deletingLastPathComponent() }
    return roots.map { $0 + "/scripts/camera-track.mjs" }.first { FileManager.default.fileExists(atPath: $0) }
}

let t0 = CFAbsoluteTimeGetCurrent()
var specPath = flags["spec"]
var tempSpec: String?
if specPath == nil {
    guard let script = studioScript() else { fail("cannot find studio/scripts/camera-track.mjs (set DOLLY_STUDIO to the studio folder)") }
    let tmp = NSTemporaryDirectory() + "dolly-spec-\(getpid()).json"
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = ["node", script, positional[0]] + passthrough + ["--out", tmp]
    do { try p.run() } catch { fail("cannot run node: \(error.localizedDescription)") }
    p.waitUntilExit()
    if p.terminationStatus != 0 { fail("camera-track.mjs failed") }
    specPath = tmp; tempSpec = tmp
}
let prepSeconds = CFAbsoluteTimeGetCurrent() - t0

do {
    let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: URL(fileURLWithPath: specPath!)))
    if let t = tempSpec { try? FileManager.default.removeItem(atPath: t) }
    if !spec.unsupported.isEmpty { fail("this style needs the Remotion renderer (not supported natively yet: \(spec.unsupported.joined(separator: ", "))). Use: node dolly.mjs render <dir> --engine remotion") }
    let outPath = flags["out"] ?? (positional.first.map { $0 + "/out.mp4" } ?? "out.mp4")
    var opt = Encoder.Options()
    opt.hevc = flags["codec"] == "hevc"
    if let q = flags["quality"].flatMap(Double.init) { opt.quality = min(1, max(0.05, q)) }
    if let b = flags["bitrate"].flatMap(Double.init) { opt.bitrate = Int(b * 1_000_000) }
    let n = min(spec.frames, flags["frames"].flatMap(Int.init) ?? spec.frames)

    let t1 = CFAbsoluteTimeGetCurrent()
    let comp = try Compositor(spec: spec)
    let source = try await FrameSource(url: URL(fileURLWithPath: spec.video), outputFps: spec.fps)
    let faceSource = spec.facecam != nil ? try await FrameSource(url: URL(fileURLWithPath: spec.facecam!.path), outputFps: spec.fps) : nil
    let enc = try await Encoder(url: URL(fileURLWithPath: outPath), width: spec.width, height: spec.height, fps: spec.fps, frames: n, opt: opt, audio: spec.audio)
    let setupSeconds = CFAbsoluteTimeGetCurrent() - t1

    // loading covers: the frozen frame of each window, kept only while it is on screen
    var coverImage: [Int: CIImage] = [:]
    var coverLast: [Int: Int] = [:]
    for (k, e) in spec.x { if let c = e.cov, let fi = Int(k) { coverLast[Int(c[0])] = max(coverLast[Int(c[0])] ?? 0, fi) } }
    var nextCover = 0
    let coverOrder = spec.covers.indices.sorted { spec.covers[$0].ms < spec.covers[$1].ms }

    let canvas = CGRect(x: 0, y: 0, width: spec.width, height: spec.height)
    var renderSeconds = 0.0
    let t2 = CFAbsoluteTimeGetCurrent()
    for fi in 0..<n {
        try autoreleasepool {
            let t = spec.f[fi][0]
            let ex = spec.x[String(fi)]
            while nextCover < coverOrder.count, spec.covers[coverOrder[nextCover]].ms <= t {
                let ci = coverOrder[nextCover]
                if coverLast[ci] != nil, let im = source.image(at: spec.covers[ci].ms, drop: false) { coverImage[ci] = im }
                nextCover += 1
            }
            guard var video = source.image(at: t, drop: true) else { throw Fail("the recording has no frames") }
            if let s2 = ex?.s2, let second = source.image(at: s2, drop: false) {
                video = video.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": second, "inputTime": 0.5])
            }
            var cover: (CIImage, Double)?
            if let c = ex?.cov, let im = coverImage[Int(c[0])] { cover = (im, c[1]) }
            // the face-cam clip runs in output time (Narrate renders at normal speed), from its start offset
            let face = faceSource?.image(at: Double(fi) * 1000 / spec.fps + (spec.facecam?.startMs ?? 0), drop: true)
            let img = comp.frame(fi, video: video, cover: cover, face: face)
            let pb = try enc.newBuffer()
            let r0 = CFAbsoluteTimeGetCurrent()
            comp.context.render(img, to: pb, bounds: canvas, colorSpace: nil)
            renderSeconds += CFAbsoluteTimeGetCurrent() - r0
            try enc.append(pb, frame: fi)
            for (ci, last) in coverLast where last == fi { coverImage[ci] = nil }
        }
    }
    let loopSeconds = CFAbsoluteTimeGetCurrent() - t2
    source.cancel()
    faceSource?.cancel()
    let t3 = CFAbsoluteTimeGetCurrent()
    try await enc.finish(frames: n)
    let finishSeconds = CFAbsoluteTimeGetCurrent() - t3
    let total = CFAbsoluteTimeGetCurrent() - t0

    var ru = rusage()
    getrusage(RUSAGE_SELF, &ru)
    let size = ((try? FileManager.default.attributesOfItem(atPath: outPath)[.size]) as? NSNumber)?.doubleValue ?? 0
    let f1 = { (v: Double) in String(format: "%.2f", v) }
    print("rendered \(outPath): \(n) frames \(spec.width)x\(spec.height)@\(Int(spec.fps.rounded())) in \(f1(total)) s (\(Int((Double(n) / max(0.001, loopSeconds + finishSeconds)).rounded())) fps), \(f1(size / 1_048_576)) MB, peak memory \(Int(Double(ru.ru_maxrss) / 1_048_576)) MB")
    if flags["stats"] != nil {
        let cpu = Double(ru.ru_utime.tv_sec) + Double(ru.ru_utime.tv_usec) / 1e6 + Double(ru.ru_stime.tv_sec) + Double(ru.ru_stime.tv_usec) / 1e6
        print("  prepare \(f1(prepSeconds)) s, setup \(f1(setupSeconds)) s, frames \(f1(loopSeconds)) s (decode \(f1(source.decodeSeconds)), composite \(f1(renderSeconds)), waiting for the encoder \(f1(enc.waitSeconds))), finish \(f1(finishSeconds)) s")
        print("  decoded \(source.decoded) frames, blended \(source.blended); cpu time \(f1(cpu)) s (\(Int((100 * cpu / max(0.001, total)).rounded())) % of one core)")
    }
} catch {
    fail("dolly-render: \(error)")
}
