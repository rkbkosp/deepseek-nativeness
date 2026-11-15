import AppKit
import Foundation

final class ReferenceAttachment: NSTextAttachment {
    let occurrence = UUID().uuidString
    let canonical: String
    init(_ canonical: String) {
        self.canonical = canonical
        super.init(data: nil, ofType: nil)
        let label = NSTextAttachmentCell(textCell: " ◈ Fixture会话 ")
        label.font = NSFont.systemFont(ofSize: 14, weight: .regular)
        label.attributedStringValue = NSAttributedString(string: " ◈ Fixture会话 ",attributes: [.foregroundColor:NSColor.controlAccentColor,.font:NSFont.systemFont(ofSize:14)])
        attachmentCell = label
    }
    required init?(coder: NSCoder) { fatalError("proof does not unarchive") }
}
final class ProofTextView: NSTextView {
    let history = UndoManager()
    var alive = true
    var ownerEpoch = 1
    var submitCount = 0
    var suppressedIME = 0
    var markedKeysForwarded = 0
    var nativeMarkedHandling = false
    var callbacks = 0
    override var undoManager: UndoManager? { history }
    override func keyDown(with event: NSEvent) {
        guard alive else { return }
        if event.keyCode == 36 {
            if hasMarkedText() {
                suppressedIME += 1; markedKeysForwarded += 1
                nativeMarkedHandling = true
                defer { nativeMarkedHandling = false }
                super.keyDown(with: event)
                return
            }
            if event.modifierFlags.contains(.command) || !event.modifierFlags.contains(.shift) { submitCount += 1; return }
        }
        super.keyDown(with: event)
    }
    func canonical(_ range: NSRange) -> String {
        guard let storage = textStorage else { return "" }
        let limit = NSRange(location: 0, length: storage.length)
        let r = NSIntersectionRange(range, limit)
        var out = ""
        storage.enumerateAttributes(in: r) { attrs, span, _ in
            if let attachment = attrs[.attachment] as? ReferenceAttachment { out += attachment.canonical }
            else { out += (storage.string as NSString).substring(with: span) }
        }
        return out
    }
    override func writeSelection(to pasteboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
        pasteboard.clearContents()
        return pasteboard.setString(canonical(selectedRange()), forType: .string)
    }
    func lateCallback(_ capturedEpoch: Int, _ body: String) -> Bool {
        guard alive, ownerEpoch == capturedEpoch else { return false }
        insertText(body, replacementRange: selectedRange())
        callbacks += 1
        return true
    }
    func retireOwner() { alive = false; ownerEpoch += 1; delegate = nil; history.removeAllActions() }
}
final class ProofOwner {
    let scroll = NSScrollView(frame: NSRect(x: 0,y: 0,width: 600,height: 150))
    let editor = ProofTextView(frame: NSRect(x: 0,y: 0,width: 600,height: 150))
    init() {
        editor.isRichText = true; editor.importsGraphics = false
        editor.allowsUndo = true; editor.isEditable = true; editor.isSelectable = true
        editor.drawsBackground = false; editor.font = NSFont.systemFont(ofSize: 14)
        editor.textColor = .labelColor; editor.textContainerInset = NSSize(width: 12,height: 8)
        editor.isHorizontallyResizable = false; editor.isVerticallyResizable = true
        editor.autoresizingMask = [.width]; editor.textContainer?.widthTracksTextView = true
        scroll.drawsBackground = false; scroll.hasVerticalScroller = true; scroll.documentView = editor
        seed()
    }
    func seed() {
        let value = NSMutableAttributedString(string: "前🙂 ",attributes: [.font:NSFont.systemFont(ofSize:14),.foregroundColor:NSColor.labelColor])
        value.append(NSAttributedString(attachment: ReferenceAttachment("@[Fixture会话](dsh-session:ImZpeHR1cmUi)")))
        value.append(NSAttributedString(string: " 后",attributes: [.font:NSFont.systemFont(ofSize:14),.foregroundColor:NSColor.labelColor]))
        editor.textStorage?.setAttributedString(value); editor.setSelectedRange(NSRange(location:value.length,length:0));editor.history.removeAllActions()
    }
    func checks() -> [String:Any] {
        var checks: [String:Bool] = [:]
        seed()
        let raw = editor.string as NSString
        let chip = raw.range(of: "\u{FFFC}")
        checks["utf16-caret"] = chip.location == 4 && raw.length == 7
        let attachment = editor.textStorage?.attribute(.attachment, at: chip.location, effectiveRange:nil) as? ReferenceAttachment
        let occurrence = attachment?.occurrence
        let pb = NSPasteboard.withUniqueName()
        editor.setSelectedRange(NSRange(location:0,length:raw.length))
        _ = editor.writeSelection(to:pb,types:[.string])
        checks["copy-canonical-projection"] = pb.string(forType:.string) == "前🙂 @[Fixture会话](dsh-session:ImZpeHR1cmUi) 后"
        pb.releaseGlobally()
        editor.setSelectedRange(NSRange(location:chip.location+1,length:0))
        editor.deleteBackward(nil)
        checks["atomic-backspace"] = !editor.string.contains("\u{FFFC}") && editor.string == "前🙂  后"
        checks["undo-registered"] = editor.history.canUndo
        editor.history.undo()
        let restored = editor.textStorage?.attribute(.attachment, at:chip.location,effectiveRange:nil) as? ReferenceAttachment
        checks["undo-occurrence"] = editor.string == raw as String && restored?.occurrence == occurrence
        editor.history.redo()
        checks["redo-atomic-delete"] = !editor.string.contains("\u{FFFC}")
        seed()
        editor.setMarkedText("拼音",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
        checks["actual-marked-state"] = editor.hasMarkedText()
        let enter = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:.command,timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
        editor.keyDown(with:enter)
        checks["marked-cmd-enter-no-submit"] = editor.submitCount == 0 && editor.suppressedIME == 1
        editor.insertText("拼音",replacementRange:editor.markedRange())
        checks["native-commit-does-not-submit"] = editor.submitCount == 0
        editor.unmarkText()
        editor.keyDown(with:enter)
        checks["committed-cmd-enter-submit-intent"] = editor.submitCount == 1
        seed()
        editor.setMarkedText("拼音",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
        let plainReturn = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
        let beforeSend=editor.submitCount, beforeForwarded=editor.markedKeysForwarded
        editor.keyDown(with:plainReturn)
        checks["marked-plain-return-forwarded-to-AppKit"] = editor.markedKeysForwarded == beforeForwarded+1 && editor.submitCount == beforeSend
        editor.unmarkText()
        seed()
        let token = editor.ownerEpoch
        editor.retireOwner()
        let before = editor.string
        checks["closed-owner-late-callback"] = !editor.lateCallback(token,"late") && editor.string == before
        // A local proof may re-enable its stable surface for GUI focus checks.
        editor.alive = true; seed()
        return ["checks":checks,"passed":checks.values.allSatisfy{$0},"nativeMarkedTest":"NSTextInputClient.setMarkedText plus NSEvent.keyDown; not a physical Pinyin candidate-panel test","scope":"local fixture only; no Host/network","utf16":["chip":chip.location,"length":raw.length]]
    }
}
@_cdecl("nd_proof_create") public func createProof() -> UnsafeMutableRawPointer {
    precondition(Thread.isMainThread)
    return Unmanaged.passRetained(ProofOwner()).toOpaque()
}
func owner(_ p: UnsafeMutableRawPointer) -> ProofOwner { Unmanaged<ProofOwner>.fromOpaque(p).takeUnretainedValue() }
@_cdecl("nd_proof_view") public func proofView(_ p: UnsafeMutableRawPointer) -> UnsafeMutableRawPointer { Unmanaged.passUnretained(owner(p).scroll).toOpaque() }
@_cdecl("nd_proof_checks") public func proofChecks(_ p: UnsafeMutableRawPointer) -> UnsafeMutablePointer<CChar>? {
    let data = try! JSONSerialization.data(withJSONObject:owner(p).checks(),options:[.sortedKeys])
    return strdup(String(data:data,encoding:.utf8)!)
}
@_cdecl("nd_proof_free") public func proofFree(_ p: UnsafeMutableRawPointer) { free(p) }
@_cdecl("nd_proof_focus") public func proofFocus(_ p: UnsafeMutableRawPointer) { let o=owner(p);o.scroll.window?.makeFirstResponder(o.editor) }
@_cdecl("nd_proof_focuscheck") public func proofFocusCheck(_ p: UnsafeMutableRawPointer) -> Int32 { let o=owner(p);return o.scroll.window?.firstResponder === o.editor ? 1:0 }
@_cdecl("nd_proof_bounds") public func proofBounds(_ p: UnsafeMutableRawPointer) -> UnsafeMutablePointer<CChar>? {
 let o=owner(p);let r=o.scroll.frame
 return strdup("{\"x\":\(r.origin.x),\"y\":\(r.origin.y),\"width\":\(r.width),\"height\":\(r.height),\"attached\":\(o.scroll.window != nil)}")
}
@_cdecl("nd_proof_destroy") public func proofDestroy(_ p: UnsafeMutableRawPointer) { let o=Unmanaged<ProofOwner>.fromOpaque(p).takeRetainedValue();o.editor.retireOwner();o.scroll.removeFromSuperview() }
