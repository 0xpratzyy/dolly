import AVFoundation
import ApplicationServices
import CoreGraphics
import Foundation

enum Permissions {
    /// The app the user must grant access to is the terminal running us, not dolly-record.
    static var hostApp: String {
        switch ProcessInfo.processInfo.environment["TERM_PROGRAM"] {
        case "Apple_Terminal": return "Terminal"
        case "iTerm.app": return "iTerm"
        case "vscode": return "Visual Studio Code"
        case "ghostty": return "Ghostty"
        case let other?: return other
        case nil: return "the app running this command"
        }
    }

    static var screenRecording: Bool { CGPreflightScreenCaptureAccess() }
    static var accessibility: Bool { AXIsProcessTrusted() }

    static var screenHint: String {
        "grant Screen Recording to \(hostApp) in System Settings → Privacy & Security → Screen Recording, then quit and reopen it"
    }
    static var accessibilityHint: String {
        "grant Accessibility to \(hostApp) in System Settings → Privacy & Security → Accessibility, then quit and reopen it"
    }

    /// `--check`: prints status and returns true when everything is granted.
    static func printCheck() -> Bool {
        let screen = screenRecording, ax = accessibility
        print("Screen Recording: \(screen ? "granted" : "NOT granted")")
        print("Accessibility:    \(ax ? "granted" : "NOT granted")")
        if !screen {
            print("\nTo grant Screen Recording: open System Settings → Privacy & Security → Screen Recording,")
            print("turn on \(hostApp) (add it with + if missing), then quit and reopen \(hostApp).")
        }
        if !ax {
            print("\nTo grant Accessibility: open System Settings → Privacy & Security → Accessibility,")
            print("turn on \(hostApp) (add it with + if missing), then quit and reopen \(hostApp).")
            print("(Needed for the mouse-click, scroll and key event tap.)")
        }
        return screen && ax
    }

    /// Microphone: ask once if undecided (waits at most 30 s), fail fast if denied.
    static func requireMicrophone() async throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return
        case .notDetermined:
            let granted = await withTaskGroup(of: Bool.self) { group in
                group.addTask { await AVCaptureDevice.requestAccess(for: .audio) }
                group.addTask { try? await Task.sleep(for: .seconds(30)); return false }
                let first = await group.next() ?? false
                group.cancelAll()
                return first
            }
            if !granted { throw Fail("Microphone permission was not granted: allow \(hostApp) in System Settings → Privacy & Security → Microphone, or drop --mic") }
        default:
            throw Fail("Microphone permission denied: allow \(hostApp) in System Settings → Privacy & Security → Microphone, or drop --mic")
        }
    }
}

struct Fail: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}
