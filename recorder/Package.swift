// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "dolly-recorder",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "dolly-record", targets: ["dolly-record"]),
        .executable(name: "dolly-render", targets: ["dolly-render"]),
    ],
    targets: [
        // Pure, testable logic: coordinate conversion, events.json model, key labels.
        .target(name: "DollyCore"),
        // The CLI: args, permissions, ScreenCaptureKit capture, AVAssetWriter, event taps.
        .executableTarget(name: "dolly-record", dependencies: ["DollyCore"]),
        // The native renderer: hardware decode -> Core Image on Metal -> hardware encode, driven by the studio's render spec.
        .executableTarget(name: "dolly-render", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "DollyCoreTests", dependencies: ["DollyCore"]),
    ]
)
