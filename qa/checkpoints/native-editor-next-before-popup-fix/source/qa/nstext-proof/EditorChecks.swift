import AppKit
import Foundation
private var proofKinds=[String]()
private let proofCallback:ComposerCallback={_,p,n in guard let p else{return};if let value=(try? JSONSerialization.jsonObject(with:Data(bytes:p,count:Int(n)))) as? [String:Any],let kind=value["kind"] as? String{proofKinds.append(kind)}}
@_cdecl("nd_editor_selftest") public func editorSelfTest()->UnsafeMutablePointer<CChar>? {
    precondition(Thread.isMainThread)
    let o=ComposerOwner(999,proofCallback)
    let baseline=(o.snapshot()["surfaceCount"] as! Int)-1
    let pointer=Unmanaged.passUnretained(o.scroll).toOpaque()
    var checks=[String:Bool]()
    func scope(_ key:String,_ epoch:String,_ runs:[[String:Any]]){_ = o.command(["op":"scope","epoch":epoch,"docKey":key,"runs":runs])}
    func cmd(_ op:String,_ more:[String:Any]=[:])->[String:Any]{var p:[String:Any]=["op":op,"epoch":o.epoch,"docKey":o.docKey];for(k,v)in more{p[k]=v};return o.command(p)}
    let ref:[String:Any]=["kind":"reference","id":"occurrence-stable","ref":"@[Fixture](dsh-session:ImEi)","label":"Fixture","appearance":"session","clipboardText":"@[Fixture](dsh-session:ImEi)"]
    scope("document-a","epoch-a",[["kind":"text","text":"前🙂 "],ref,["kind":"text","text":" 后"]])
    checks["utf16-native-caret"] = o.text.string.utf16.count==7 && o.text.selectedRange().location==7
    let pb=NSPasteboard.withUniqueName();o.text.setSelectedRange(NSRange(location:0,length:7));_ = o.text.writeSelection(to:pb,types:[.string]);checks["canonical-clipboard"] = pb.string(forType:.string)=="前🙂 @[Fixture](dsh-session:ImEi) 后";pb.releaseGlobally()
    o.text.setSelectedRange(NSRange(location:5,length:0));o.text.deleteBackward(nil);checks["atomic-reference-delete"] = o.text.string=="前🙂  后"
    o.text.undoManager?.undo();checks["undo-identity"] = (o.text.textStorage?.attribute(.attachment,at:4,effectiveRange:nil) as? Chip)?.fields["id"] as? String == "occurrence-stable"
    // Separate documents retain their own undo managers on a stable view.
    let savedRuns=o.runs();scope("document-b","epoch-b",[["kind":"text","text":"B"]]);let bUndo=o.documentUndo
    scope("document-a","epoch-a2",savedRuns);checks["document-undo-isolation"] = o.documentUndo !== bUndo && o.text.string.contains("\u{FFFC}")
    let commandChip:[String:Any]=["kind":"command","id":"permission-command","label":"/permission","clipboardText":"/permission"]
    scope("command-document","command-epoch",[commandChip,["kind":"text","text":" "]])
    o.text.setSelectedRange(NSRange(location:1,length:0))
    let back=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"",charactersIgnoringModifiers:"",isARepeat:false,keyCode:51)!
    o.text.keyDown(with:back);checks["command-first-delete-selects"] = o.text.string.contains("\u{FFFC}") && o.text.selectedCommand=="permission-command"
    o.text.keyDown(with:back);checks["command-second-delete-removes"] = !o.text.string.contains("\u{FFFC}")
    scope("command-parameter","command-parameter1",[commandChip,["kind":"text","text":" "]]);_ = cmd("replace",["start":1,"end":2,"runs":[["kind":"text","text":" readonly"]]])
    checks["parameter-replacement-preserves-command-occurrence"] = (o.text.textStorage?.attribute(.attachment,at:0,effectiveRange:nil) as? Chip)?.fields["id"] as? String == "permission-command" && o.canonical()=="/permission readonly"
    scope("displaced-command","displaced1",[commandChip,["kind":"text","text":" "]]);o.text.insertText("x",replacementRange:NSRange(location:0,length:0))
    checks["displaced-command-becomes-literal"] = !o.text.string.contains("\u{FFFC}") && o.canonical()=="x/permission "
    scope("ime-document","ime-epoch",[["kind":"text","text":""]])
    o.text.setMarkedText("拼音",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
    let submitBefore=proofKinds.filter{$0=="submit"}.count
    let cmdReturn=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:.command,timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
    o.text.keyDown(with:cmdReturn);checks["marked-cmd-enter-no-submit"] = proofKinds.filter{$0=="submit"}.count==submitBefore
    o.text.insertText("拼音",replacementRange:o.text.markedRange());o.text.unmarkText();checks["native-commit-no-extra-submit"] = proofKinds.filter{$0=="submit"}.count==submitBefore
    o.text.keyDown(with:cmdReturn);checks["committed-enter-one-intent"] = proofKinds.filter{$0=="submit"}.count==submitBefore+1
    o.text.setMarkedText("输入",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:NSNotFound,length:0))
    let plainReturn=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
    let plainBefore=proofKinds.filter{$0=="submit"}.count;o.text.keyDown(with:plainReturn);checks["marked-plain-return-forwarded-no-submit"] = proofKinds.filter{$0=="submit"}.count==plainBefore
    o.text.unmarkText()
    _ = cmd("style",["style":["dark":true,"foreground":"#e0e0e2","accent":"#9cbdff"]])
    checks["forced-dark-native-appearance"] = o.scroll.appearance?.name == .darkAqua && o.text.appearance?.name == .darkAqua
    _ = cmd("style",["style":["dark":false,"foreground":"#17181b","accent":"#477be2"]])
    checks["forced-light-native-appearance"] = o.scroll.appearance?.name == .aqua && o.text.appearance?.name == .aqua
    scope("same-doc","old-ref-epoch",[ref])
    var changedRef=ref;changedRef["ref"]="@different";changedRef["clipboardText"]="@different";changedRef["id"]="different-ref"
    scope("same-doc","new-ref-epoch",[changedRef]);checks["same-detect-new-reference-not-restored-old"] = o.canonical()=="@different"
    scope("paint-command","paint-epoch",[commandChip,["kind":"text","text":" "]]);o.text.setSelectedRange(NSRange(location:1,length:0));o.text.keyDown(with:back)
    let selectedCell=(o.text.textStorage?.attribute(.attachment,at:0,effectiveRange:nil) as? Chip)?.attachmentCell as? ChipCell
    let arrow=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"",charactersIgnoringModifiers:"",isARepeat:false,keyCode:124)!
    o.text.keyDown(with:arrow);checks["command-arrow-clears-painted-selection"] = o.text.selectedCommand==nil && selectedCell?.selected==false
    o.text.setSelectedRange(NSRange(location:1,length:0));o.text.keyDown(with:back);_ = o.text.resignFirstResponder();checks["command-blur-clears-painted-selection"] = o.text.selectedCommand==nil && selectedCell?.selected==false
    for size in [10,14,22]{
      scope("font-\(size)","font-epoch-\(size)",[["kind":"text","text":"Ag中文🙂"]]);_ = cmd("style",["style":["fontSize":size,"dark":true,"foreground":"#e0e0e2"]]);o.text.layoutManager?.ensureLayout(for:o.text.textContainer!)
      let line=o.text.layoutManager!.lineFragmentRect(forGlyphAt:0,effectiveRange:nil)
      checks["font-\(size)-line-fragment"] = line.height >= CGFloat(size+10)-0.5 && line.height <= CGFloat(size+12)
    }
    scope("theme-a","theme-a1",[["kind":"text","text":"A"]]);let savedA=o.runs();scope("theme-b","theme-b1",[["kind":"text","text":"B"]]);_ = cmd("style",["style":["fontSize":22,"dark":false,"foreground":"#17181b"]]);scope("theme-a","theme-a2",savedA)
    let aFont=o.text.textStorage?.attribute(.font,at:0,effectiveRange:nil) as? NSFont
    checks["restored-plain-text-current-style"] = aFont?.pointSize==22
    scope("style-undo-a","style-undo-a1",[["kind":"text","text":"A"]]);o.text.insertText(" edit",replacementRange:NSRange(location:1,length:0));o.text.breakUndoCoalescing();o.text.setSelectedRange(NSRange(location:1,length:2));let undoA=o.runs()
    scope("style-undo-b","style-undo-b1",[["kind":"text","text":"B"]]);_ = cmd("style",["style":["fontSize":14,"dark":true,"foreground":"#e0e0e2"]]);scope("style-undo-a","style-undo-a2",undoA)
    checks["document-selection-restored"] = o.text.selectedRange()==NSRange(location:1,length:2)
    _ = cmd("undo");let restoredFont=o.text.textStorage?.attribute(.font,at:0,effectiveRange:nil) as? NSFont;let restoredColor=o.text.textStorage?.attribute(.foregroundColor,at:0,effectiveRange:nil) as? NSColor
    checks["undo-plain-text-current-global-style"] = restoredFont?.pointSize==14 && restoredColor==o.style.foreground
    let oldEpoch=o.epoch,before=o.canonical();_ = o.command(["op":"replace","epoch":"retired","docKey":o.docKey,"start":0,"end":0,"runs":[["kind":"text","text":"late"]]])
    checks["stale-epoch-rejected"] = o.canonical()==before && o.epoch==oldEpoch
    for i in 0..<50{scope("switch-\(i)","epoch-\(i)",[["kind":"text","text":"local draft \(i)"]])}
    checks["fifty-scopes-one-native-view"] = (o.snapshot()["surfaceCount"] as! Int)==baseline+1 && Unmanaged.passUnretained(o.scroll).toOpaque()==pointer
    let second=ComposerOwner(1000,nil);checks["separate-window-surface"] = second.scroll !== o.scroll && (o.snapshot()["surfaceCount"] as! Int)==baseline+2
    second.close();checks["second-window-close-independent"] = !o.closed && second.closed
    o.close();let after=o.text.string;let late=o.command(["op":"replace","epoch":o.epoch,"docKey":o.docKey,"start":0,"end":0,"runs":[["kind":"text","text":"late"]]])
    checks["closed-owner-rejects-command"] = late["error"] as? String=="CLOSED" && o.text.string==after
    let data=try! JSONSerialization.data(withJSONObject:["checks":checks,"passed":checks.values.allSatisfy{$0},"scope":"real AppKit/Swift component local fixture; no Host/network","surfaceCreated":(o.snapshot()["surfaceCount"] as! Int)-baseline],options:[.sortedKeys])
    return strdup(String(data:data,encoding:.utf8)!)
}
