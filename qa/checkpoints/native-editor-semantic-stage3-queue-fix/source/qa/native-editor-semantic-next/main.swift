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
checks["literal-placeholder-semantic-seed-rejected-before-owner-change"] = scope([["kind":"text","text":"new\u{FFFC}tail"]],"invalid-placeholder")["error"] as? String == "INVALID_RUN_OR_SOURCE" && owner.canonical()==before && owner.docKey=="fixture"

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
let duplicateBefore=owner.semanticDigest
checks["duplicate-existing-occurrence-rejected-before-insert"] = command("replaceSpan",["start":5,"end":5,"runs":[freshReference],"expectedSemanticRevision":owner.semanticRevision,"expectedSemanticDigest":owner.semanticDigest])["error"] as? String=="DUPLICATE_OR_INVALID_OCCURRENCE" && owner.semanticDigest==duplicateBefore
checks["invalid-seed-selection-has-no-scope-side-effect"] = owner.command(["op":"scope","docKey":"bad-selection","epoch":"bad-selection","runs":[["kind":"text","text":"🙂"]],"selection":["start":1,"end":1]])["error"] as? String=="INVALID_SELECTION" && owner.docKey=="fixture" && owner.semanticDigest==duplicateBefore

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
autoreleasepool{RunLoop.current.run(until:Date(timeIntervalSinceNow:0.03))}
let baseline=[liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers]
weak var retiredOwner:ComposerOwner?,retiredSurface:NSScrollView?,retiredText:NSTextView?
var semanticExports=[String:[[String:Any]]](),lifecycleMetrics=[String:Any]()
autoreleasepool {
    var lifecycle:ComposerOwner?=ComposerOwner(9000,nil);retiredOwner=lifecycle;retiredSurface=lifecycle!.scroll;retiredText=lifecycle!.text
    let pointer=Unmanaged.passUnretained(lifecycle!.scroll).toOpaque()
    for i in 0..<50{
        _ = lifecycle!.command(["op":"scope","epoch":"epoch-\(i)","docKey":"doc-\(i)","accountScope":"account-A","runs":[["kind":"text","text":"unsent \(i)"]]])
        lifecycle!.text.insertText(" edit",replacementRange:NSRange(location:lifecycle!.text.string.utf16.count,length:0))
    }
    let state=lifecycle!.snapshot();lifecycleMetrics["after50Scopes"]=state
    checks["fifty-scopes-one-view-but-fifty-explicit-hot-documents"] = lifecycle!.retainedDocumentCount()==50 && Unmanaged.passUnretained(lifecycle!.scroll).toOpaque()==pointer
    var exported=[String:String]()
    for(key,record)in lifecycle!.savedDocuments{exported[key]=record.semanticDigest;semanticExports[key]=lifecycle!.semanticRuns(record.content) as? [[String:Any]]}
    exported[lifecycle!.docKey]=lifecycle!.semanticDigest;semanticExports[lifecycle!.docKey]=lifecycle!.runs()
    let digest0=exported["doc-0"]!;let undo0=lifecycle!.savedDocuments["doc-0"]!.undo
    let noExport=lifecycle!.command(["op":"retireDocument","epoch":lifecycle!.epoch,"docKey":lifecycle!.docKey,"targetDocKey":"doc-0"])
    checks["retire-without-semantic-export-proof-rejected"] = noExport["error"] as? String=="SEMANTIC_EXPORT_REQUIRED" && lifecycle!.retainedDocumentCount()==50
    _ = lifecycle!.command(["op":"retireDocument","epoch":lifecycle!.epoch,"docKey":lifecycle!.docKey,"targetDocKey":"doc-0","exportedSemanticDigest":digest0])
    checks["retire-document-releases-hot-record-and-undo-actions"] = lifecycle!.retainedDocumentCount()==49 && !undo0.canUndo && lifecycle!.savedDocuments["doc-0"]==nil
    let incomplete=lifecycle!.command(["op":"retireAccount","epoch":lifecycle!.epoch,"docKey":lifecycle!.docKey,"targetAccountScope":"account-A","exportedDocuments":[:]])
    checks["retire-account-all-documents-must-be-exported-atomically"] = incomplete["error"] as? String=="SEMANTIC_EXPORT_REQUIRED" && lifecycle!.retainedDocumentCount()==49
    _ = lifecycle!.command(["op":"retireAccount","epoch":lifecycle!.epoch,"docKey":lifecycle!.docKey,"targetAccountScope":"account-A","exportedDocuments":exported])
    checks["retire-account-clears-hot-documents-keeps-exported-semantics"] = lifecycle!.retainedDocumentCount()==0 && !lifecycle!.documentUndo.canUndo && semanticExports.count==50 && semanticExports["doc-0"]?.first?["text"] as? String=="unsent 0 edit"
    _ = lifecycle!.command(["op":"scope","epoch":"rebound","docKey":"doc-0","accountScope":"account-A","runs":semanticExports["doc-0"]!,"seedSemanticRevision":42,"selection":["start":0,"end":3]])
    checks["cold-rebind-restores-selection-and-content-version-without-old-undo"] = lifecycle!.text.string=="unsent 0 edit" && lifecycle!.semanticRevision==42 && lifecycle!.text.selectedRange()==NSRange(location:0,length:3) && !lifecycle!.documentUndo.canUndo
    lifecycle!.text.insertText("new",replacementRange:NSRange(location:0,length:0))
    _ = lifecycle!.command(["op":"scope","epoch":"close-other","docKey":"close-other","accountScope":"account-B","runs":[["kind":"text","text":"B"]]])
    lifecycle!.text.insertText(" edit",replacementRange:NSRange(location:1,length:0));let currentUndo=lifecycle!.documentUndo;let savedUndo=lifecycle!.savedDocuments["doc-0"]!.undo
    lifecycle!.close();checks["window-close-clears-current-and-every-saved-undo-before-owner-detach"] = !currentUndo.canUndo && !savedUndo.canUndo && lifecycle!.savedDocuments.isEmpty && lifecycle!.docKey.isEmpty
    lifecycleMetrics["afterCloseBeforeARC"]=lifecycle!.snapshot();lifecycle=nil
}
let immediateAfter=[liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers]
autoreleasepool{RunLoop.current.run(until:Date(timeIntervalSinceNow:0.03))}
let after=[liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers]
lifecycleMetrics["immediateZeroReleaseObserved"] = baseline==after && retiredOwner==nil && retiredSurface==nil && retiredText==nil
lifecycleMetrics["baselineLiveObjects"]=baseline;lifecycleMetrics["afterARCLiveObjects"]=after
lifecycleMetrics["immediateAfterARCLiveObjects"]=immediateAfter;lifecycleMetrics["runloopDrainMilliseconds"]=30
lifecycleMetrics["weakOwnerReleasedAfter30ms"]=retiredOwner==nil;lifecycleMetrics["weakSurfaceReleasedAfter30ms"]=retiredSurface==nil;lifecycleMetrics["weakTextViewReleasedAfter30ms"]=retiredText==nil
var ownerCloseTrend=[[Int]]()
for cycle in 0..<50{
    autoreleasepool{
        let transient=ComposerOwner(UInt64(10000+cycle),nil)
        _ = transient.command(["op":"scope","epoch":"transient-\(cycle)","docKey":"transient-\(cycle)","accountScope":"fixture-account","runs":[["kind":"text","text":"local draft"]]])
        transient.text.insertText(" typing",replacementRange:NSRange(location:11,length:0));transient.close()
    }
    autoreleasepool{RunLoop.current.run(until:Date(timeIntervalSinceNow:0.01))}
    ownerCloseTrend.append([liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers])
}
lifecycleMetrics["fiftyOwnerCloseTrend"]=ownerCloseTrend
lifecycleMetrics["zeroDelayAllCyclesReturnedToBaseline"] = ownerCloseTrend.allSatisfy{$0==baseline}
var timedDrain=[[String:Any]]()
for milliseconds in [100,300,1000]{autoreleasepool{RunLoop.current.run(until:Date(timeIntervalSinceNow:Double(milliseconds)/1000))};timedDrain.append(["drainMilliseconds":milliseconds,"liveObjects":[liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers]])}
lifecycleMetrics["timedRunloopDrain"]=timedDrain
let quiescent=[liveComposerOwners,liveComposerSurfaces,liveComposerTextViews,liveComposerUndoManagers]
checks["fifty-owner-close-all-live-objects-return-after-public-runloop-drain"] = quiescent==baseline && retiredOwner==nil && retiredSurface==nil && retiredText==nil && ownerCloseTrend.allSatisfy{$0[0]==baseline[0] && $0[1]==baseline[1]}
lifecycleMetrics["quiescentWeakOwnerReleased"]=retiredOwner==nil;lifecycleMetrics["quiescentWeakSurfaceReleased"]=retiredSurface==nil;lifecycleMetrics["quiescentWeakTextViewReleased"]=retiredText==nil
lifecycleMetrics["classification"]="Deferred text-system retention during rapid edit/close; zero extra tracked objects after measured public runloop quiescence. Cause not isolated; no RSS/GPU inference."
let result:[String:Any]=["stage":"3-retirement-document-store-and-object-cleanup","passed":checks.values.allSatisfy{$0},"checks":checks,"digestSamples":digestSamples,"lifecycleMetrics":lifecycleMetrics,"scope":"actual NSTextView local methods; no public NativeView GUI/no Host/network; ARC count not native RSS/GPU peak","normalAndFrozenNextUnchanged":true]
let data=try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]);let target=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"/tmp/native-editor-semantic-stage1.json";try! data.write(to:URL(fileURLWithPath:target));print(String(data:data,encoding:.utf8)!);if !(checks.values.allSatisfy{$0}){exit(1)}
