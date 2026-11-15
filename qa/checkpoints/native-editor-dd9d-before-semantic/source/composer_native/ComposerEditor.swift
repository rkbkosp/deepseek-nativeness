import AppKit
import Foundation

public typealias ComposerCallback = @convention(c) (UInt64, UnsafePointer<UInt8>?, Int64) -> Void
private let refKey = NSAttributedString.Key("NativeDSHReference")
private var createdSurfaces = 0

final class ComposerStyle {
 var font=NSFont.systemFont(ofSize:14,weight:.light)
 var foreground=NSColor.labelColor,accent=NSColor.controlAccentColor,selection=NSColor.selectedTextBackgroundColor,placeholder=NSColor.placeholderTextColor
 var paragraph:NSParagraphStyle {let p=NSMutableParagraphStyle();p.minimumLineHeight=font.pointSize+10;p.maximumLineHeight=font.pointSize+10;return p}
 var attributes:[NSAttributedString.Key:Any]{[.font:font,.foregroundColor:foreground,.paragraphStyle:paragraph]}
 func color(_ value:Any?,_ fallback:NSColor)->NSColor{guard var text=value as? String else{return fallback};text=text.replacingOccurrences(of:"#",with:"");guard text.count==6,let v=UInt32(text,radix:16)else{return fallback};return NSColor(srgbRed:CGFloat((v>>16)&255)/255,green:CGFloat((v>>8)&255)/255,blue:CGFloat(v&255)/255,alpha:1)}
 func apply(_ p:[String:Any],_ editor:NSTextView,_ scroll:NSScrollView){
 let size=max(10,min(32,CGFloat((p["fontSize"] as? NSNumber)?.doubleValue ?? 14)));let family=p["fontFamily"] as? String ?? "";let weight=(p["fontWeight"] as? Int ?? 300)<400 ? NSFont.Weight.light:.regular
 font=family.isEmpty ? NSFont.systemFont(ofSize:size,weight:weight):(NSFont(name:family,size:size) ?? NSFont.systemFont(ofSize:size,weight:weight))
 foreground=color(p["foreground"],foreground);accent=color(p["accent"],accent);selection=color(p["selection"],selection);placeholder=color(p["placeholder"],placeholder)
 let appearance=NSAppearance(named:(p["dark"] as? Bool ?? false) ? .darkAqua:.aqua);scroll.appearance=appearance;editor.appearance=appearance;editor.textColor=foreground;editor.insertionPointColor=foreground;editor.selectedTextAttributes=[.backgroundColor:selection,.foregroundColor:foreground];editor.typingAttributes=attributes
 if let storage=editor.textStorage{storage.addAttributes(attributes,range:NSRange(location:0,length:storage.length));editor.layoutManager?.invalidateLayout(forCharacterRange:NSRange(location:0,length:storage.length),actualCharacterRange:nil)}
 }
}
final class Chip: NSTextAttachment {
    let fields: [String:Any]
    init(_ fields: [String:Any],_ style:ComposerStyle) {
        self.fields=fields
        super.init(data:nil,ofType:nil)
        attachmentCell = ChipCell(fields,style)
    }
    required init?(coder:NSCoder){fatalError("Application draft codec is explicit")}
}
final class ChipCell: NSTextAttachmentCell {
    let label: String
    let appearance: String
    var selected=false
    let style:ComposerStyle
    init(_ f:[String:Any],_ style:ComposerStyle) {
        self.style=style
        label=f["label"] as? String ?? "";appearance=f["appearance"] as? String ?? ""
        super.init(textCell:label)
    }
    required init(coder:NSCoder){fatalError("Application draft codec is explicit")}
    override func cellSize()->NSSize {
        let width=(label as NSString).size(withAttributes:[.font:style.font]).width
        return NSSize(width:min(240,max(1,width+8+(appearance.isEmpty ? 0:17))),height:style.font.pointSize+10)
    }
    override func draw(withFrame frame:NSRect,in controlView:NSView?) {
        var r=frame.insetBy(dx:4,dy:0)
        if selected{style.selection.setFill();NSBezierPath(roundedRect:frame,xRadius:4,yRadius:4).fill()}
        if !appearance.isEmpty {
            drawReferenceGlyph(appearance,NSRect(x:r.minX,y:r.minY+(r.height-14)/2,width:14,height:14),controlView?.isFlipped ?? true,style.accent)
            r.origin.x += 17;r.size.width -= 17
        }
        let paragraph=NSMutableParagraphStyle();paragraph.lineBreakMode = .byTruncatingTail
        (label as NSString).draw(in:r,withAttributes:[.font:style.font,.foregroundColor:style.accent,.paragraphStyle:paragraph])
    }
}
final class ComposerTextView: NSTextView {
    weak var owner: ComposerOwner?
    private let ownUndo=UndoManager()
    var markedHandling=false
    var selectedCommand: String?
    override var undoManager:UndoManager? {owner?.documentUndo ?? ownUndo}
    override func becomeFirstResponder()->Bool {let ok=super.becomeFirstResponder();if ok{owner?.emit("focus",extra:["focused":true])};return ok}
    override func resignFirstResponder()->Bool {let ok=super.resignFirstResponder();if ok{clearSelectedCommand();owner?.emit("blur",extra:["focused":false])};return ok}
    override func didChangeText(){super.didChangeText();guard let o=owner,!o.closed else{return};o.normalizeCommandSeat();if undoManager?.isUndoing==true || undoManager?.isRedoing==true{o.applyGlobalStyle()};o.emit("change")}
    override func keyDown(with event:NSEvent){
        guard let o=owner,!o.closed else{return}
        let key=event.keyCode,mods=event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if hasMarkedText(){markedHandling=true;defer{markedHandling=false};super.keyDown(with:event);return}
        if (key==36||key==76), !mods.contains(.shift) {
            o.emit(o.completionOpen ? "completionReturn":"submit",extra:["accelerated":mods.contains(.command)||mods.contains(.control),"repeat":event.isARepeat]);return
        }
        if o.completionOpen && [48,53,125,126].contains(Int(key)){
            o.emit("completionKey",extra:["key":key,"shift":mods.contains(.shift),"repeat":event.isARepeat]);return
        }
        if (key==51 || key==117) && mods.intersection([.command,.control,.option]).isEmpty {
            let selected=selectedRange(),backward=key==51
            let position=backward ? selected.location-1:selected.location
            if selected.length==0,position>=0,position<(textStorage?.length ?? 0),let chip=textStorage?.attribute(.attachment,at:position,effectiveRange:nil) as? Chip,chip.fields["kind"] as? String=="command"{
                let id=chip.fields["id"] as? String ?? ""
                if selectedCommand != id {selectedCommand=id;(chip.attachmentCell as? ChipCell)?.selected=true;needsDisplay=true;o.emit("selection");return}
                selectedCommand=nil;(chip.attachmentCell as? ChipCell)?.selected=false
                if backward {deleteBackward(nil)}else{deleteForward(nil)};return
            }
        }
        clearSelectedCommand()
        super.keyDown(with:event)
    }
    func clearSelectedCommand(){selectedCommand=nil;if let storage=textStorage{storage.enumerateAttribute(.attachment,in:NSRange(location:0,length:storage.length)){value,_,_ in if let chip=value as? Chip{(chip.attachmentCell as? ChipCell)?.selected=false}}};needsDisplay=true}
    override func mouseDown(with event:NSEvent){clearSelectedCommand();super.mouseDown(with:event)}
    override func draw(_ dirtyRect:NSRect){super.draw(dirtyRect);if string.isEmpty,!hasMarkedText(),let o=owner{let a:[NSAttributedString.Key:Any]=[.font:o.style.font,.foregroundColor:o.style.placeholder];("发消息或创建任务, / 调用指令, @ 文件或对话" as NSString).draw(at:NSPoint(x:textContainerInset.width,y:textContainerInset.height),withAttributes:a)}}
    override func insertText(_ insertString:Any,replacementRange:NSRange){
        guard owner?.closed != true else{return}
        if let text=insertString as? String {super.insertText(text.replacingOccurrences(of:"\u{FFFC}",with:""),replacementRange:replacementRange)}
        else{super.insertText(insertString,replacementRange:replacementRange)}
    }
    override func writeSelection(to pb:NSPasteboard,types:[NSPasteboard.PasteboardType])->Bool {
        guard let o=owner,!o.closed else{return false};pb.clearContents();return pb.setString(o.canonical(selectedRange()),forType:.string)
    }
    override func paste(_ sender:Any?){
        guard let o=owner,!o.closed else{return}
        let pb=NSPasteboard.general
        if pb.data(forType:.png) != nil || pb.propertyList(forType:.fileURL) != nil {o.emit("pasteAttachments",extra:["text":pb.string(forType:.string) ?? ""]);return}
        if let text=pb.string(forType:.string){insertText(text,replacementRange:selectedRange())}
    }
}
final class ComposerOwner:NSObject,NSTextViewDelegate {
    let style=ComposerStyle()
    let id:UInt64
    let callback:ComposerCallback?
    let scroll=NSScrollView(frame:NSRect(x:0,y:0,width:600,height:96))
    let text=ComposerTextView(frame:NSRect(x:0,y:0,width:600,height:96))
    var epoch="",docKey="",revision=0,closed=false,suppress=false,normalizing=false,completionOpen=false
    var documentUndo=UndoManager()
    var savedDocuments=[String:(NSAttributedString,NSRange,UndoManager)]()
    init(_ id:UInt64,_ callback:ComposerCallback?){
        self.id=id;self.callback=callback;super.init();createdSurfaces += 1
        text.owner=self;text.delegate=self;text.allowsUndo=true;text.isRichText=true;text.importsGraphics=false
        text.drawsBackground=false;text.backgroundColor = .clear;text.textColor = .labelColor;text.font=style.font
        text.textContainerInset=NSSize(width:0,height:0);text.isVerticallyResizable=true;text.isHorizontallyResizable=false
        text.autoresizingMask=[.width];text.textContainer?.widthTracksTextView=true;text.textContainer?.lineFragmentPadding=0
        text.typingAttributes=style.attributes;scroll.drawsBackground=false;scroll.hasVerticalScroller=true;scroll.documentView=text
    }
    func textViewDidChangeSelection(_ notification:Notification){emit("selection")}
    func canonical(_ range:NSRange?=nil)->String {
        guard let storage=text.textStorage else{return ""}
        let r=NSIntersectionRange(range ?? NSRange(location:0,length:storage.length),NSRange(location:0,length:storage.length));var pieces=[String]()
        storage.enumerateAttributes(in:r){attrs,span,_ in
            if let chip=attrs[.attachment] as? Chip {pieces.append(chip.fields["clipboardText"] as? String ?? "")}
            else{pieces.append((storage.string as NSString).substring(with:span))}
        };return pieces.joined()
    }
    func runs()->[[String:Any]] {
        guard let storage=text.textStorage else{return []};var output=[[String:Any]]()
        storage.enumerateAttributes(in:NSRange(location:0,length:storage.length)){attrs,r,_ in
            if let chip=attrs[.attachment] as? Chip {output.append(chip.fields)}
            else{output.append(["kind":"text","text":(storage.string as NSString).substring(with:r)])}
        };return output
    }
    func snapshot(_ kind:String="snapshot",extra:[String:Any]=[:])->[String:Any]{
        let selection=text.selectedRange();var out:[String:Any]=["kind":kind,"id":id,"epoch":epoch,"docKey":docKey,"revision":revision,"runs":runs(),"detectText":text.string,"canonicalText":canonical(),"selectionStart":selection.location,"selectionEnd":selection.location+selection.length,"marked":text.hasMarkedText(),"focused":scroll.window?.firstResponder === text,"selectedCommand":text.selectedCommand ?? "","surfaceCount":createdSurfaces]
        for(k,v)in extra{out[k]=v};return out
    }
    func emit(_ kind:String,extra:[String:Any]=[:]){
        guard !closed,!suppress,!epoch.isEmpty,!docKey.isEmpty,let callback else{return};revision += 1
        guard let data=try? JSONSerialization.data(withJSONObject:snapshot(kind,extra:extra)) else{return}
        data.withUnsafeBytes{raw in callback(id,raw.baseAddress?.assumingMemoryBound(to:UInt8.self),Int64(raw.count))}
    }
    func attributed(_ runs:[[String:Any]])->NSAttributedString {
        let value=NSMutableAttributedString(string:"")
        for run in runs {
            if run["kind"] as? String=="text"{value.append(NSAttributedString(string:(run["text"] as? String ?? "").replacingOccurrences(of:"\u{FFFC}",with:""),attributes:style.attributes))}
            else{var fields=run;if fields["id"] == nil{fields["id"]=UUID().uuidString};value.append(NSAttributedString(attachment:Chip(fields,style)))}
        };return value
    }
    func semanticRuns(_ value:NSAttributedString)->NSArray {
 var result=[[String:Any]]();value.enumerateAttributes(in:NSRange(location:0,length:value.length)){a,r,_ in if let chip=a[.attachment] as? Chip{result.append(chip.fields)}else{result.append(["kind":"text","text":(value.string as NSString).substring(with:r)])}};return result as NSArray
 }
 func applyGlobalStyle(){if let storage=text.textStorage{storage.addAttributes(style.attributes,range:NSRange(location:0,length:storage.length));text.typingAttributes=style.attributes}}
    func normalizeCommandSeat(){
        guard !normalizing,!text.hasMarkedText(),let storage=text.textStorage,!text.undoManager!.isUndoing,!text.undoManager!.isRedoing else{return}
        var changes=[(NSRange,String)]()
        storage.enumerateAttribute(.attachment,in:NSRange(location:0,length:storage.length)){value,r,_ in
            if r.location != 0,let chip=value as? Chip,chip.fields["kind"] as? String=="command"{changes.append((r,chip.fields["clipboardText"] as? String ?? ""))}
        }
        normalizing=true;defer{normalizing=false}
        for(r,literal)in changes.reversed(){text.insertText(NSAttributedString(string:literal,attributes:style.attributes),replacementRange:r)}
    }
    func command(_ p:[String:Any])->[String:Any]{
        guard !closed else{return ["error":"CLOSED"]}
        let op=p["op"] as? String ?? ""
        let wasSuppressed=suppress;suppress=true;defer{suppress=wasSuppressed}
        if op=="scope" {
            suppress=true;defer{suppress=false};text.unmarkText();text.clearSelectedCommand()
            let nextKey=p["docKey"] as? String ?? ""
            if !docKey.isEmpty,let storage=text.textStorage {savedDocuments[docKey]=(storage.copy() as! NSAttributedString,text.selectedRange(),documentUndo)}
            epoch=p["epoch"] as? String ?? "";docKey=nextKey
            let seeded=attributed(p["runs"] as? [[String:Any]] ?? [])
            var restoredSelection:NSRange?
            if let saved=savedDocuments[nextKey],semanticRuns(saved.0) == semanticRuns(seeded) {
                text.textStorage?.setAttributedString(saved.0);documentUndo=saved.2
                restoredSelection=saved.1
            }else{documentUndo=UndoManager();text.textStorage?.setAttributedString(seeded)}
            text.typingAttributes=style.attributes;applyGlobalStyle()
            let start=min(max(0,p["start"] as? Int ?? restoredSelection?.location ?? text.string.utf16.count),text.string.utf16.count)
            let length=min(restoredSelection?.length ?? 0,text.string.utf16.count-start)
            text.setSelectedRange(NSRange(location:start,length:length));revision += 1;return snapshot()
        }
        guard p["epoch"] as? String==epoch,p["docKey"] as? String==docKey else{return ["error":"STALE_OWNER"]}
        switch op {
        case "style":style.apply(p["style"] as? [String:Any] ?? [:],text,scroll)
        case "replace":
            let start=p["start"] as? Int ?? 0,end=p["end"] as? Int ?? start
            guard start>=0,end>=start,end<=text.string.utf16.count,!text.hasMarkedText() else{return ["error":"INVALID_RANGE"]}
            if let expected=p["expectedCanonical"] as? String,expected != canonical(){return ["error":"STALE_DRAFT"]}
            text.insertText(attributed(p["runs"] as? [[String:Any]] ?? []),replacementRange:NSRange(location:start,length:end-start));text.clearSelectedCommand()
        case "selection":
            let start=min(max(0,p["start"] as? Int ?? 0),text.string.utf16.count),end=min(max(0,p["end"] as? Int ?? 0),text.string.utf16.count)
            text.setSelectedRange(NSRange(location:min(start,end),length:abs(end-start)))
        case "focus": scroll.window?.makeFirstResponder(text)
        case "completion":completionOpen=p["open"] as? Bool ?? false
        case "undo":text.undoManager?.undo();applyGlobalStyle()
        case "redo":text.undoManager?.redo();applyGlobalStyle()
        case "snapshot":break
        default:return ["error":"INVALID_OPERATION"]
        }
        revision += 1;return snapshot()
    }
    func close(){guard !closed else{return};closed=true;epoch="";text.unmarkText();text.delegate=nil;text.owner=nil;text.isEditable=false;text.undoManager?.removeAllActions();scroll.removeFromSuperview()}
}
@_cdecl("nd_editor_create") public func ndCreate(_ id:UInt64,_ callback:ComposerCallback?)->UnsafeMutableRawPointer{precondition(Thread.isMainThread);return Unmanaged.passRetained(ComposerOwner(id,callback)).toOpaque()}
@_cdecl("nd_editor_view") public func ndView(_ ptr:UnsafeMutableRawPointer)->UnsafeMutableRawPointer{Unmanaged.passUnretained(Unmanaged<ComposerOwner>.fromOpaque(ptr).takeUnretainedValue().scroll).toOpaque()}
@_cdecl("nd_editor_command") public func ndCommand(_ ptr:UnsafeMutableRawPointer,_ bytes:UnsafePointer<UInt8>,_ count:Int64)->UnsafeMutablePointer<CChar>?{
    guard count>=0,count<=1048576,let p=(try? JSONSerialization.jsonObject(with:Data(bytes:bytes,count:Int(count)))) as? [String:Any] else{return strdup("{\"error\":\"INVALID_JSON\"}")}
    let o=Unmanaged<ComposerOwner>.fromOpaque(ptr).takeUnretainedValue();let result=o.command(p)
    let data=try! JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]);return strdup(String(data:data,encoding:.utf8)!)
}
@_cdecl("nd_editor_free") public func ndFree(_ p:UnsafeMutableRawPointer){free(p)}
@_cdecl("nd_editor_length") public func ndLength(_ p:UnsafePointer<CChar>)->Int64{Int64(strlen(p))}
@_cdecl("nd_editor_close") public func ndClose(_ ptr:UnsafeMutableRawPointer){let o=Unmanaged<ComposerOwner>.fromOpaque(ptr).takeRetainedValue();o.close()}
