import AppKit
import Foundation

let workspace = NSWorkspace.shared
let bundles = ["com.apple.Safari", "com.apple.SafariTechnologyPreview"]
let initial = workspace.runningApplications.filter { bundles.contains($0.bundleIdentifier ?? "") }
let initialForeground = workspace.frontmostApplication
var launched: [NSRunningApplication] = []
var activated = false
var finished = false

func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data + Data([10]))
}
let observer = workspace.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { notification in
    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
          bundles.contains(app.bundleIdentifier ?? ""), !initial.contains(where: { $0.isEqual(app) }) else { return }
    launched.append(app)
    emit(["event": "launched", "pid": Int(app.processIdentifier), "bundle": app.bundleIdentifier ?? ""])
}
emit(["event": "ready", "initial": initial.map { ["pid": Int($0.processIdentifier), "bundle": $0.bundleIdentifier ?? ""] }])
DispatchQueue.global().async {
    while let command = readLine() {
        DispatchQueue.main.async {
            if command.hasPrefix("activate-stp ") {
                let owned = launched.filter { $0.bundleIdentifier == "com.apple.SafariTechnologyPreview" && !$0.isTerminated }
                let allowed = owned.count == 1 && !initial.contains(where: { $0.isEqual(owned[0]) })
                let accepted = allowed && owned[0].unhide() && owned[0].activate(options: [.activateAllWindows])
                activated = activated || accepted
                emit(["event": "activation", "request": command, "accepted": accepted,
                      "ownedPids": owned.map { Int($0.processIdentifier) }])
                return
            }
            if command == "finish", activated,
               let current = workspace.frontmostApplication,
               launched.contains(where: { $0.isEqual(current) }),
               let previous = initialForeground, !previous.isTerminated {
                _ = previous.activate(options: [])
            }
            emit(["event": "snapshot", "request": command, "initialPreserved": initial.allSatisfy { !$0.isTerminated },
                  "launched": launched.map { ["pid": Int($0.processIdentifier), "terminated": $0.isTerminated] }])
            if command == "finish" { finished = true }
        }
    }
    DispatchQueue.main.async { finished = true }
}
while !finished { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
workspace.notificationCenter.removeObserver(observer)
