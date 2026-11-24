import Foundation

struct Options {
    var out: String?
    var display = "main"
    var window: String?
    var fps = 60
    var mic = false
    var duration: Double?
    var countdown = 3
    var check = false
    var list = false
    var help = false

    struct ParseError: Error, CustomStringConvertible {
        let description: String
    }

    static func parse(_ args: [String]) throws -> Options {
        var o = Options()
        var i = 0
        func value(_ flag: String) throws -> String {
            i += 1
            guard i < args.count else { throw ParseError(description: "\(flag) needs a value") }
            return args[i]
        }
        func number<T: LosslessStringConvertible>(_ flag: String, _ type: T.Type) throws -> T {
            let s = try value(flag)
            guard let n = T(s) else { throw ParseError(description: "\(flag): '\(s)' is not a number") }
            return n
        }
        while i < args.count {
            let a = args[i]
            switch a {
            case "--out", "-o": o.out = try value(a)
            case "--display": o.display = try value(a)
            case "--window": o.window = try value(a)
            case "--fps": o.fps = try number(a, Int.self)
            case "--duration": o.duration = try number(a, Double.self)
            case "--countdown": o.countdown = try number(a, Int.self)
            case "--mic": o.mic = true
            case "--check": o.check = true
            case "--list": o.list = true
            case "--help", "-h": o.help = true
            default: throw ParseError(description: "unknown option '\(a)'")
            }
            i += 1
        }
        guard (1...120).contains(o.fps) else { throw ParseError(description: "--fps must be 1...120") }
        guard o.countdown >= 0 else { throw ParseError(description: "--countdown must be >= 0") }
        if let d = o.duration, d <= 0 { throw ParseError(description: "--duration must be > 0") }
        return o
    }
}

let usage = """
dolly-record: record the screen for Dolly (video + cursor/click/key/scroll events)

USAGE
  dolly-record --out <dir> [options]   record until Ctrl-C (or --duration), then finalise
  dolly-record --check                 show Screen Recording / Accessibility permission status
  dolly-record --list                  list displays and windows (id, size, title)

OPTIONS
  --out <dir>          output folder; gets recording.mov and events.json
  --display main|<id>  display to record (default: main; ids from --list)
  --window "<text>"    record one window instead: its id from --list, or title/app name contains <text>
  --fps <n>            frame rate, default 60
  --mic                also record the microphone into recording.mov
  --duration <sec>     stop automatically after this many seconds
  --countdown <sec>    countdown before recording starts, default 3
"""
