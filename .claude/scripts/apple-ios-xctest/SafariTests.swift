import XCTest

final class SafariTests: XCTestCase {
    struct Journey: Decodable {
        let version: Int
        let steps: [Step]
    }
    struct Step: Decodable {
        let action: String
        let text: String?
        let visible: Bool?
        let label: String?
        let kind: String?
        let from: [Double]?
        let to: [Double]?
        let name: String?
        let timeoutMs: Int?
        let optional: Bool?
        let scopeLabel: String?
        let maxSwipes: Int?
        let direction: String?
        let allowToolbarCovered: Bool?
        let expectText: String?
        let overlay: String?
        let path: String?
    }

    var journeyEvidence: [[String: Any]] = []
    var dialogDiagnostics: [[String: Any]] = []

    func failure(_ message: String) -> NSError {
        NSError(domain: "SafariQA", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func redacted(_ label: String) -> String {
        String(label.replacingOccurrences(of: "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", with: "[redacted email]", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "\\b(password|token|secret|authorization)\\b\\s*[:=]\\s*\\S+", with: "$1=[redacted]", options: [.regularExpression, .caseInsensitive]).prefix(200))
    }

    @MainActor
    func exactQuery(_ root: XCUIElement, kind: String, label: String) throws -> XCUIElementQuery {
        let query: XCUIElementQuery
        switch kind {
        case "button": query = root.buttons
        case "link": query = root.links
        case "text": query = root.staticTexts
        default: throw failure("Unknown native label kind")
        }
        return query.matching(NSPredicate(format: "label == %@", label))
    }

    @MainActor
    func scopedRoot(_ web: XCUIElement, label: String?, timeout: TimeInterval = 0) throws -> XCUIElement {
        guard let label else { return web }
        let matches = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        return try waitFor(matches, hittable: false, timeout: timeout)
    }

    @MainActor
    func waitFor(_ query: XCUIElementQuery, hittable: Bool, timeout: TimeInterval) throws -> XCUIElement {
        let until = Date().addingTimeInterval(timeout)
        repeat {
            let count = query.count
            if count > 1 { throw failure("Native label is ambiguous") }
            if count == 1 && (!hittable || query.firstMatch.isHittable) { return query.firstMatch }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < until
        throw failure("Native label wait timed out")
    }

    @MainActor
    func collectDialogs(_ web: XCUIElement, safari: XCUIApplication, scope: String?) {
        let until = Date().addingTimeInterval(2)
        let candidates = web.descendants(matching: .any).allElementsBoundByIndex.prefix(80)
        for element in candidates {
            if Date() >= until || dialogDiagnostics.count >= 12 { break }
            guard element.exists, element.isHittable else { continue }
            let label = element.label
            let known = label.range(of: "dialog|modal|newsletter|bounce|klaviyo|geolocation|preview", options: [.regularExpression, .caseInsensitive]) != nil
            let control = [XCUIElement.ElementType.button, .link, .staticText].contains(element.elementType)
            guard element.elementType == .alert || element.elementType == .sheet || known || label == scope || control else { continue }
            let rect = element.frame.intersection(web.frame).intersection(safari.frame)
            guard !rect.isNull, rect.width > 0, rect.height > 0 else { continue }
            dialogDiagnostics.append(["tag": "accessibility-type-\(element.elementType.rawValue)", "rect": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height], "display": "unavailable via XCTest", "text": redacted(label)])
        }
    }

    /// Returns false when no keyboard is up. Ambiguous or missing Done controls fail rather than guessing.
    @MainActor
    func dismissKeyboard(_ safari: XCUIApplication, timeout: TimeInterval) throws -> Bool {
        let keyboard = safari.keyboards.firstMatch
        guard keyboard.exists else { return false }
        let done = safari.buttons.matching(NSPredicate(format: "label == %@", "Done"))
        guard done.count == 1, done.firstMatch.isHittable else { throw failure("Keyboard needs exactly one hittable Done control") }
        done.firstMatch.tap()
        guard keyboard.waitForNonExistence(timeout: timeout) else { throw failure("Keyboard dismissal timed out") }
        return true
    }

    @MainActor
    func toolbarTap(_ target: XCUIElement, web: XCUIElement, safari: XCUIApplication) throws -> CGPoint {
        let targetFrame = target.frame
        let toolbars = safari.toolbars.allElementsBoundByIndex.filter { $0.exists && !$0.frame.isEmpty }.map { $0.frame }
        guard toolbars.contains(where: { !$0.intersection(targetFrame).isNull && !$0.intersection(targetFrame).isEmpty }) else {
            throw failure("Coordinate fallback requires observed partial Safari toolbar coverage")
        }
        var regions = [targetFrame.intersection(web.frame).intersection(safari.frame).intersection(safari.windows.firstMatch.frame)]
        for toolbar in toolbars {
            regions = regions.flatMap { rect -> [CGRect] in
                let covered = rect.intersection(toolbar)
                if covered.isNull || covered.isEmpty { return [rect] }
                return [CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: max(0, covered.minY - rect.minY)),
                    CGRect(x: rect.minX, y: covered.maxY, width: rect.width, height: max(0, rect.maxY - covered.maxY)),
                    CGRect(x: rect.minX, y: covered.minY, width: max(0, covered.minX - rect.minX), height: covered.height),
                    CGRect(x: covered.maxX, y: covered.minY, width: max(0, rect.maxX - covered.maxX), height: covered.height)]
            }
        }
        guard let rect = regions.filter({ !$0.isNull && $0.width >= 6 && $0.height >= 6 }).max(by: { $0.width * $0.height < $1.width * $1.height }) else {
            throw failure("Toolbar-covered target has no safe point inside the webview and screen")
        }
        let point = CGPoint(x: rect.midX, y: rect.midY), frame = web.frame
        guard frame.width > 0, frame.height > 0, point.x.isFinite, point.y.isFinite else { throw failure("Invalid native coordinate geometry") }
        web.coordinate(withNormalizedOffset: CGVector(dx: (point.x - frame.minX) / frame.width, dy: (point.y - frame.minY) / frame.height)).tap()
        return point
    }

    @MainActor
    func runJourney(_ raw: String, start: URL, safari: XCUIApplication, web: XCUIElement) throws {
        let journey = try JSONDecoder().decode(Journey.self, from: Data(raw.utf8))
        XCTAssertEqual(journey.version, 1)
        for (index, step) in journey.steps.enumerated() {
            try XCTContext.runActivity(named: "Step \(index + 1): \(step.action)") { _ in
                var evidence: [String: Any] = ["step": index + 1, "action": step.action, "status": "completed"]
                defer {
                    journeyEvidence.append(evidence)
                    let image = XCTAttachment(screenshot: safari.screenshot())
                    image.name = "Step \(index + 1): \(step.name ?? step.action)"
                    image.lifetime = .keepAlways
                    self.add(image)
                }
                let timeout = Double(step.timeoutMs ?? 15000) / 1000
                let deadline = Date().addingTimeInterval(timeout)
                let remaining = { max(0, deadline.timeIntervalSinceNow) }
                do {
                switch step.action {
                case "assertText", "waitFor":
                    let root = try scopedRoot(web, label: step.scopeLabel, timeout: remaining())
                    let label = try XCTUnwrap(step.text ?? step.label)
                    _ = try waitFor(exactQuery(root, kind: step.text == nil ? (step.kind ?? "text") : "text", label: label), hittable: step.visible != false, timeout: remaining())
                case "tap":
                    let label = try XCTUnwrap(step.label)
                    if step.optional == true, let scope = step.scopeLabel {
                        let containers = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", scope))
                        guard containers.count <= 1 else { throw failure("Optional tap accessibility scope is ambiguous") }
                        if containers.count == 0 { evidence["status"] = "skipped"; evidence["reason"] = "optional scope absent"; break }
                    }
                    let root = try scopedRoot(web, label: step.scopeLabel, timeout: remaining())
                    let matches = try exactQuery(root, kind: step.kind ?? "", label: label)
                    if step.optional == true {
                        while matches.count == 0 && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
                        guard matches.count <= 1 else { throw failure("Optional tap label is ambiguous") }
                        if matches.count == 0 || !matches.firstMatch.isHittable {
                            evidence["status"] = "skipped"
                            evidence["reason"] = matches.count == 0 ? "optional target absent" : "optional target not hittable"
                            break
                        }
                    }
                    let target = try waitFor(matches, hittable: step.allowToolbarCovered != true, timeout: remaining())
                    if let expected = step.expectText {
                        guard try exactQuery(web, kind: "text", label: expected).count == 0 else { throw failure("Changed-state text is already present before tap") }
                    }
                    if target.isHittable { target.tap(); evidence["input"] = "native element tap" }
                    else if step.allowToolbarCovered == true {
                        let point = try toolbarTap(target, web: web, safari: safari)
                        evidence["input"] = "explicit toolbar-edge native coordinate tap"
                        evidence["point"] = ["x": point.x, "y": point.y]
                    } else { throw failure("Tap target is not hittable; no coordinate fallback authorised") }
                    if let expected = step.expectText {
                        _ = try waitFor(exactQuery(web, kind: "text", label: expected), hittable: true, timeout: remaining())
                        evidence["assertion"] = "Changed-state text became hittable"
                    }
                case "scrollTo":
                    let root = try scopedRoot(web, label: step.scopeLabel, timeout: remaining())
                    let matches = try exactQuery(root, kind: step.kind ?? "", label: try XCTUnwrap(step.label))
                    var swipes = 0
                    while !(matches.count == 1 && matches.firstMatch.isHittable) {
                        guard matches.count <= 1 else { throw failure("Scroll label is ambiguous") }
                        guard swipes < (step.maxSwipes ?? 6), Date() < deadline else { throw failure("scrollTo timed out or exhausted bounded swipes") }
                        let down = step.direction != "up"
                        let start = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.75 : 0.25))
                        let end = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: down ? 0.25 : 0.75))
                        start.press(forDuration: 0.1, thenDragTo: end)
                        swipes += 1
                    }
                    evidence["swipes"] = swipes
                    evidence["assertion"] = "Exact target is hittable after bounded scrolling"
                case "dismissOverlay":
                    let scope = try XCTUnwrap(step.scopeLabel), overlay = try XCTUnwrap(step.overlay)
                    let matches = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@", scope))
                    guard matches.count <= 1 else { throw failure("Overlay accessibility scope is ambiguous") }
                    if matches.count == 0 { evidence["status"] = "skipped"; evidence["reason"] = "optional overlay absent"; break }
                    let root = matches.firstMatch
                    // A focused signup field can raise the keyboard over the overlay's close control.
                    if try dismissKeyboard(safari, timeout: remaining()) { evidence["keyboard"] = "dismissed" }
                    if !root.isHittable { evidence["status"] = "skipped"; evidence["reason"] = "optional overlay not hittable"; break }
                    let raw = try XCTUnwrap(ProcessInfo.processInfo.environment["SAFARI_QA_OVERLAYS"])
                    let profiles = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: [String: Any]])
                    let labels = try XCTUnwrap(profiles[overlay]?["labels"] as? [String])
                    let controls = root.buttons.matching(NSPredicate(format: "label IN %@", labels))
                    guard controls.count == 1 else { throw failure("Overlay needs exactly one scoped native dismiss button") }
                    guard controls.firstMatch.isHittable else { throw failure("Scoped overlay dismiss button is not hittable") }
                    controls.firstMatch.tap()
                    guard root.waitForNonExistence(timeout: remaining()) else { throw failure("Overlay dismissal timed out; scoped accessibility container remains") }
                    evidence["assertion"] = "Scoped overlay accessibility container no longer exists"
                case "swipe":
                    let from = try XCTUnwrap(step.from)
                    let to = try XCTUnwrap(step.to)
                    XCTAssertEqual(from.count, 2)
                    XCTAssertEqual(to.count, 2)
                    let start = web.coordinate(withNormalizedOffset: CGVector(dx: from[0], dy: from[1]))
                    let end = web.coordinate(withNormalizedOffset: CGVector(dx: to[0], dy: to[1]))
                    start.press(forDuration: 0.1, thenDragTo: end)
                case "navigate":
                    let target = try XCTUnwrap(URL(string: try XCTUnwrap(step.path), relativeTo: start)?.absoluteURL)
                    guard target.scheme == start.scheme, target.host == start.host, target.port == start.port else { throw failure("Navigation must stay on the starting origin") }
                    safari.open(target)
                    evidence["input"] = "native URL open"
                    _ = try waitFor(exactQuery(web, kind: "text", label: try XCTUnwrap(step.expectText)), hittable: true, timeout: remaining())
                    evidence["assertion"] = "Expected text hittable after navigation"
                case "back":
                    if try dismissKeyboard(safari, timeout: remaining()) { evidence["keyboard"] = "dismissed" }
                    let control = try waitFor(safari.toolbars.buttons.matching(NSPredicate(format: "label == %@", "Back")), hittable: true, timeout: remaining())
                    control.tap()
                    evidence["input"] = "Safari toolbar Back button"
                    _ = try waitFor(exactQuery(web, kind: "text", label: try XCTUnwrap(step.expectText)), hittable: true, timeout: remaining())
                    evidence["assertion"] = "Expected text hittable after Back"
                case "dismissKeyboard":
                    if try dismissKeyboard(safari, timeout: remaining()) { evidence["assertion"] = "Keyboard no longer exists" }
                    else { evidence["status"] = "skipped"; evidence["reason"] = "no keyboard shown" }
                case "screenshot": break
                default: throw NSError(domain: "SafariQA", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown journey action"])
                }
                } catch {
                    evidence["status"] = "failed"
                    evidence["error"] = error.localizedDescription
                    collectDialogs(web, safari: safari, scope: step.scopeLabel)
                    throw error
                }
            }
        }
    }

    @MainActor
    func testNativeJourney() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let rawURL = try XCTUnwrap(environment["SAFARI_QA_URL"])
        let url = try XCTUnwrap(URL(string: rawURL))
        XCTAssertTrue(["http", "https"].contains(url.scheme ?? ""))
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        addTeardownBlock {
            let evidence: [String: Any] = ["steps": self.journeyEvidence, "dialogs": self.dialogDiagnostics,
                "limits": ["elements": 80, "dialogs": 12, "text": 200, "diagnosticSeconds": 2],
                "scope": "XCTest visible accessibility containers/controls and screen frames only; dialog grouping, DOM tags/CSS display, closed shadow roots and input values unavailable"]
            if let bytes = try? JSONSerialization.data(withJSONObject: evidence), let text = String(data: bytes, encoding: .utf8) {
                let attachment = XCTAttachment(string: text)
                attachment.name = "Safari journey evidence"
                attachment.lifetime = .keepAlways
                self.add(attachment)
            }
            let screenshot = XCTAttachment(screenshot: safari.screenshot())
            screenshot.name = "Safari final state"
            screenshot.lifetime = .keepAlways
            self.add(screenshot)
            safari.terminate()
        }
        safari.open(url)
        let web = safari.webViews.firstMatch
        guard web.waitForExistence(timeout: 30) else { throw failure("Native webview wait timed out") }
        if let journey = environment["SAFARI_QA_JOURNEY"], !journey.isEmpty {
            try runJourney(journey, start: url, safari: safari, web: web)
            return
        }
        if environment["SAFARI_QA_FIXTURE"] != "1" {
            let expected = try XCTUnwrap(environment["SAFARI_QA_EXPECT"])
            let query = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", expected))
            do { _ = try waitFor(query, hittable: false, timeout: 30) }
            catch { collectDialogs(web, safari: safari, scope: nil); throw error }
            return
        }
        XCTAssertTrue(web.staticTexts["Everyday tee"].waitForExistence(timeout: 30), "Fixture heading unavailable")
        web.buttons["Product details"].tap()
        XCTAssertTrue(web.staticTexts["Soft cotton. Intentional heading clamp."].waitForExistence(timeout: 10), "Fixture disclosure unavailable")
        let market = web.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND (elementType == %d OR elementType == %d)", "Market", XCUIElement.ElementType.popUpButton.rawValue, XCUIElement.ElementType.button.rawValue)).firstMatch
        XCTAssertTrue(market.exists, "Fixture market control unavailable")
        market.tap()
        let nz = safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "New Zealand")).firstMatch
        XCTAssertTrue(nz.waitForExistence(timeout: 10), "Fixture market option unavailable")
        nz.tap()
        if safari.buttons["Done"].exists { safari.buttons["Done"].tap() }
        XCTAssertTrue(web.staticTexts["NZD 45"].waitForExistence(timeout: 10), "Fixture market result unavailable")
        let quantity = web.textFields["Quantity"]
        XCTAssertTrue(quantity.exists, "Fixture quantity control unavailable")
        quantity.tap()
        quantity.press(forDuration: 1.2)
        let selectAll = safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@ AND (elementType == %d OR elementType == %d)", "Select All", XCUIElement.ElementType.menuItem.rawValue, XCUIElement.ElementType.button.rawValue)).firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 10), "Fixture text selection unavailable")
        selectAll.tap()
        quantity.typeText("2")
        XCTAssertEqual(quantity.value as? String, "2", "Fixture quantity differs")
        if safari.buttons["Done"].exists { safari.buttons["Done"].tap() }
        web.buttons["Add to cart"].tap()
        XCTAssertTrue(web.staticTexts["2 \u{00D7} Everyday tee | NZ | 90 NZD"].waitForExistence(timeout: 15), "Fixture cart result unavailable")
    }
}
