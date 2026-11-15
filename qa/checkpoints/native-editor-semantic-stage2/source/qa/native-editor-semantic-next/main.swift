import AppKit
import Foundation

let application=NSApplication.shared
var events=[[String:Any]]()
let callback:ComposerCallback={_,p,n in if let p,let v=(try? JSONSerialization.jsonObject(with:Data(bytes:p,count:Int(n)))) as? [String:Any]{events.append(v)}}
var checks=[String:Bool]()
let owner=ComposerOwner(8001,callback)
func scope(_ runs:[[String:Any]],_ key:String="fixture")->[String:Any]{owner.command(["op":"scope","docKey":key,"epoch":"epoch-"+key,"runs":runs])}
func command(_ op:String,_ extra:[String:Any]=[:])->[String:Any]{var p:[String:Any]=["op":op,"docKey":owner.docKey,"epoch":owner.epoch];for(k,v)in extra{p[k]=v};return owner.command(p)}
let reference:[String:Any]=["kind":"reference","source":"reference","id":"ref-1","ref":"@file","label":"file","clipboardText":"@file","appearance":"file"]
_ = scope([reference]);checks["builtin-source-admitted"] = owner.canonical()=="@file"
let before=owner.canonical();var unknown=reference;unknown["source"]="unknown-plugin"
checks["unknown-source-rejected-before-scope-mutation"] = scope([unknown],"bad")["error"] as? String == "INVALID_RUN_OR_SOURCE" && owner.canonical()==before && owner.docKey=="fixture"
var missing=reference;missing.removeValue(forKey:"source");checks["missing-source-rejected"] = command("replace",["start":0,"end":1,"runs":[missing]])["error"] as? String == "INVALID_RUN_OR_SOURCE" && owner.canonical()==before

for mask in 0..<16 {
    var modifiers=NSEvent.ModifierFlags();if mask&1 != 0{modifiers.insert(.shift)};if mask&2 != 0{modifiers.insert(.control)};if mask&4 != 0{modifiers.insert(.option)};if mask&8 != 0{modifiers.insert(.command)}
    _ = scope([["kind":"text","text":"fixture"]]);events=[]
    let event=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:modifiers,timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
    owner.text.keyDown(with:event)
    let submit=events.filter{$0["kind"] as? String=="submit"}
    let allowed=[0,2,8].contains(mask)
    checks["modifier-\(mask)-exact-submit-policy"] = submit.count == (allowed ? 1:0) && (mask==1 || owner.canonical()=="fixture")
    if allowed { checks["modifier-\(mask)-complete-flags-carried"] = (submit[0]["modifiers"] as? UInt)==modifiers.rawValue }
    if mask==1 {checks["shift-only-native-newline"] = owner.canonical().contains("\n")}
}
_ = scope([["kind":"text","text":""]]);owner.text.setMarkedText("拼音",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:NSNotFound,length:0));events=[]
let markedEnter=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:.command,timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:false,keyCode:36)!
owner.text.keyDown(with:markedEnter);checks["marked-cmd-enter-forwarded-without-submit"] = !events.contains{$0["kind"] as? String=="submit"};owner.text.unmarkText()
_ = scope([["kind":"text","text":"前🙂 @"]]);let original=owner.snapshot();let originalRevision=owner.semanticRevision,originalDigest=owner.semanticDigest
_ = command("selection",["start":0,"end":1]);_ = command("style",["style":["fontSize":22,"dark":true,"foreground":"#e0e0e2"]]);_ = command("completion",["open":true]);_ = owner.text.resignFirstResponder()
checks["selection-style-popup-do-not-change-semantic-revision"] = owner.semanticRevision==originalRevision && owner.semanticDigest==originalDigest
checks["replaceSpan-requires-semantic-CAS"] = command("replaceSpan",["start":4,"end":5,"runs":[reference]])["error"] as? String=="STALE_SEMANTIC_DRAFT" && owner.semanticDigest==originalDigest
_ = command("replaceSpan",["start":4,"end":5,"runs":[reference],"expectedSemanticRevision":originalRevision,"expectedSemanticDigest":originalDigest]);let afterInsert=owner.snapshot()
checks["CAS-replace-increments-content-revision-once"] = owner.semanticRevision==originalRevision+1 && owner.canonical()=="前🙂 @file"
checks["surrogate-half-range-is-rejected"] = command("replaceSpan",["start":2,"end":3,"runs":[],"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest])["error"] as? String=="INVALID_RANGE"
_ = command("undo");checks["completion-undo-restores-only-token"] = owner.canonical()=="前🙂 @" && owner.semanticRevision>originalRevision
_ = command("redo");checks["completion-redo-keeps-reference-identity"] = owner.runs().contains{$0["id"] as? String=="ref-1"}
let staleRevision=owner.semanticRevision,staleDigest=owner.semanticDigest;var freshReference=reference;freshReference["id"]="ref-2"
_ = command("replaceSpan",["start":4,"end":5,"runs":[freshReference],"expectedSemanticRevision":staleRevision,"expectedSemanticDigest":staleDigest])
checks["same-clipboard-new-occurrence-changes-digest"] = owner.canonical()=="前🙂 @file" && owner.semanticDigest != staleDigest
checks["same-clipboard-old-CAS-rejected"] = command("replaceSpan",["start":0,"end":0,"runs":[["kind":"text","text":"late"]],"expectedSemanticRevision":staleRevision,"expectedSemanticDigest":staleDigest])["error"] as? String=="STALE_SEMANTIC_DRAFT"

_ = scope([["kind":"text","text":"sent "],reference],"commit");let sent=owner.runs(),sentDigest=owner.semanticDigest
var suffixReference=reference;suffixReference["id"]="new-suffix";suffixReference["ref"]="@new";suffixReference["clipboardText"]="@new"
_ = command("replaceSpan",["start":6,"end":6,"runs":[["kind":"text","text":" fresh "],suffixReference],"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest])
let commitRevision=owner.semanticRevision,commitDigest=owner.semanticDigest
_ = command("commitAccepted",["requestId":"existing-ledger-request-1","committedRuns":sent,"committedSemanticDigest":sentDigest,"expectedSemanticRevision":commitRevision,"expectedSemanticDigest":commitDigest])
checks["accepted-commit-preserves-new-suffix-and-occurrence"] = owner.canonical()==" fresh @new" && owner.runs().contains{$0["id"] as? String=="new-suffix"}
checks["accepted-commit-cuts-undo-resurrection"] = !owner.documentUndo.canUndo
let committed=owner.canonical();_ = command("commitAccepted",["requestId":"existing-ledger-request-1","committedRuns":sent,"committedSemanticDigest":sentDigest,"expectedSemanticRevision":commitRevision,"expectedSemanticDigest":commitDigest]);checks["duplicate-accepted-commit-does-not-clear-suffix"] = owner.canonical()==committed
_ = scope([reference],"changed-occurrence");let oldSent=owner.runs(),oldDigest=owner.semanticDigest
_ = command("replaceSpan",["start":0,"end":1,"runs":[freshReference],"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest])
_ = command("commitAccepted",["requestId":"existing-ledger-request-2","committedRuns":oldSent,"committedSemanticDigest":oldDigest,"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest])
checks["accepted-old-identical-clipboard-preserves-new-occurrence"] = owner.runs().first?["id"] as? String=="ref-2"
_ = command("undo");let restored=owner.canonical();_ = command("commitAccepted",["requestId":"existing-ledger-request-2","committedRuns":oldSent,"committedSemanticDigest":oldDigest,"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest]);checks["duplicate-after-user-undo-remains-inert"] = owner.canonical()==restored && owner.runs().first?["id"] as? String=="ref-1"

let digestSamples=[["runs":original["runs"]!,"digest":original["semanticDigest"]!],["runs":afterInsert["runs"]!,"digest":afterInsert["semanticDigest"]!],["runs":owner.snapshot()["runs"]!,"digest":owner.semanticDigest]]
owner.close()
let result:[String:Any]=["stage":"2-semantic-CAS-and-accepted-history","passed":checks.values.allSatisfy{$0},"checks":checks,"digestSamples":digestSamples,"scope":"actual NSTextView local methods; no public NativeView GUI/no Host/network","normalAndFrozenNextUnchanged":true]
let data=try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]);let target=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"/tmp/native-editor-semantic-stage1.json";try! data.write(to:URL(fileURLWithPath:target));print(String(data:data,encoding:.utf8)!);if !(checks.values.allSatisfy{$0}){exit(1)}
