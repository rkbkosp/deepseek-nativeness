import AppKit
import Foundation
import CryptoKit

let app = NSApplication.shared
var events = [[String:Any]](), checks = [String:Bool](), corpus = [String:Any]()
let callback: ComposerCallback = { _, p, n in
    if let p, let value = try? JSONSerialization.jsonObject(with: Data(bytes:p,count:Int(n))) as? [String:Any] { events.append(value) }
}
let namespace = String(repeating:"a",count:32)
func scope(_ owner:ComposerOwner,_ key:String,_ value:String,_ account:String="account") -> [String:Any] {
    owner.command(["op":"scope","docKey":key,"epoch":"cold-\(key)","accountScope":account,"runs":[["kind":"text","text":value]]])
}
func request(_ owner:ComposerOwner,_ key:String,_ account:String="account") -> [String:Any] {
    ["op":"activateHot","id":owner.id,"epoch":owner.epoch,"docKey":owner.docKey,"accountScope":owner.accountScope,
     "targetDocKey":key,"targetAccountScope":account,"activationNamespace":namespace,
     "expectedActivationGeneration":owner.activationGeneration,"afterRevision":owner.revision]
}
func stable(_ owner:ComposerOwner)->String {
    let fields:[String:Any] = ["epoch":owner.epoch,"docKey":owner.docKey,"account":owner.accountScope,"revision":owner.revision,
        "semanticRevision":owner.semanticRevision,"digest":draftSemanticDigest(owner.runs()),"generation":owner.activationGeneration,
        "namespace":owner.activationNamespace,"selectionStart":owner.text.selectedRange().location,"selectionLength":owner.text.selectedRange().length,
        "saved":owner.savedDocuments.keys.sorted(),"commits":owner.appliedCommits]
    return String(data:try! JSONSerialization.data(withJSONObject:fields,options:[.sortedKeys]),encoding:.utf8)!
}
let owner = ComposerOwner(8001,callback)
_ = scope(owner,"A","seed A")
owner.text.insertText(String(repeating:"汉",count:400000),replacementRange:NSRange(location:0,length:owner.text.string.utf16.count))
owner.text.setSelectedRange(NSRange(location:3,length:5))
owner.appliedCommits["accepted-before-navigation"] = "kept"
let aDigest = draftSemanticDigest(owner.runs()), aUndo = owner.documentUndo
let selected = owner.text.selectedRange()
checks["oversize-callback-is-bounded-invalid-with-current-revision"] = events.last?["error"] as? String == "NATIVE_FRAME_TOO_LARGE" && (events.last?["revision"] as? Int) == owner.revision && events.last?["runs"] == nil
_ = scope(owner,"B","small B")
let bSnapshot = owner.snapshot(), before = stable(owner)
var failures = [[String:Any]]()
var missing = request(owner,"missing"); failures.append(missing)
var wrongAccount = request(owner,"A","other-account"); failures.append(wrongAccount)
var tooLong = request(owner,String(repeating:"k",count:2049)); failures.append(tooLong)
var control = request(owner,"A"); control["targetAccountScope"]="bad\naccount"; failures.append(control)
var wrongOwner = request(owner,"A");wrongOwner["id"]=9001;failures.append(wrongOwner)
var wrongSource = request(owner,"A");wrongSource["epoch"]="old-A";failures.append(wrongSource)
var wrongGeneration = request(owner,"A");wrongGeneration["expectedActivationGeneration"]=1;failures.append(wrongGeneration)
for field in ["id","expectedActivationGeneration","afterRevision"] {
    for value:Any in [true,0.5,-1] { var malformed=request(owner,"A");malformed[field]=value;failures.append(malformed) }
}
checks["all-source-target-size-account-number-rejections-precede-mutation"] = failures.allSatisfy { owner.command($0)["error"] != nil && stable(owner)==before }
let savedA = owner.savedDocuments["A"]!
let savedActualDigest = draftSemanticDigest(owner.semanticRuns(savedA.content) as! [[String:Any]])
let oversizedRequest = request(owner,"A"), ack = owner.command(oversizedRequest)
corpus["oversizeAck"] = ack;corpus["oversizeRequest"] = oversizedRequest;corpus["oldB"] = bSnapshot
let firstRestoredRuns = owner.runs(), firstRestoredDigest = draftSemanticDigest(firstRestoredRuns)
let firstRaw = owner.text.string
func rawHash(_ text:String)->String { SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined() }
corpus["firstRestoreDiagnostics"] = ["aDigest":aDigest,"savedMetadataDigest":savedA.semanticDigest,"savedActualDigest":savedActualDigest,"savedSemanticRevision":savedA.semanticRevision,"ackDigest":ack["semanticDigest"] ?? "", "firstDigest":firstRestoredDigest,"firstRawUTF16":firstRaw.utf16.count,"firstRawHash":rawHash(firstRaw),"normalized":["digest":draftSemanticDigest(normalizedDraftRuns(firstRestoredRuns)),"partitions":firstRestoredRuns.map{["kind":$0["kind"] ?? "","utf16":($0["text"] as? String ?? "").utf16.count,"hash":rawHash($0["text"] as? String ?? "")] as [String:Any]}],"laterDigest":draftSemanticDigest(owner.runs())]
checks["oversize-hot-restores-exact-body-selection-undo-and-commits"] = owner.docKey=="A" && firstRestoredDigest==aDigest && owner.text.selectedRange()==selected && owner.documentUndo === aUndo && owner.appliedCommits["accepted-before-navigation"]=="kept"
checks["ack-is-small-typed-body-free-and-requires-validation"] = (try! JSONSerialization.data(withJSONObject:ack)).count <= 8192 && ack["requiresSnapshot"] as? Bool == true && ack["runs"]==nil && ack["canonicalText"]==nil && ack["detectText"]==nil && ack["epoch"] as? String == "native-hot:\(namespace):1"
let oversizedSnapshot = owner.command(["op":"snapshot","epoch":owner.epoch,"docKey":owner.docKey])
let fence = try! JSONSerialization.jsonObject(with:boundedComposerJSON(oversizedSnapshot,owner:owner)) as! [String:Any]
corpus["oversizeFence"] = fence
checks["oversize-snapshot-result-preserves-higher-binding-barrier"] = fence["error"] as? String=="NATIVE_FRAME_TOO_LARGE" && (fence["revision"] as? Int)! > (ack["revision"] as? Int)! && fence["epoch"] as? String==owner.epoch && fence["runs"]==nil
owner.text.insertText("valid repaired A",replacementRange:NSRange(location:0,length:owner.text.string.utf16.count))
corpus["validRecovery"] = owner.command(["op":"snapshot","epoch":owner.epoch,"docKey":owner.docKey])
checks["valid-edit-after-hot-activation-produces-new-body-revision"] = (corpus["validRecovery"] as! [String:Any])["canonicalText"] as? String=="valid repaired A" && owner.revision>(fence["revision"] as! Int)
let sameBody = owner.text.string, sameSelection = owner.text.selectedRange(), sameUndo = owner.documentUndo, sameCommits = owner.appliedCommits
let same = owner.command(request(owner,"A"))
checks["same-document-activation-is-nondestructive-and-has-new-native-epoch"] = owner.text.string==sameBody && owner.text.selectedRange()==sameSelection && owner.documentUndo === sameUndo && owner.appliedCommits==sameCommits && same["epoch"] as? String=="native-hot:\(namespace):2"
let afterSame = stable(owner)
checks["old-command-replay-cannot-activate-or-clear-current-hot-text"] = owner.command(oversizedRequest)["error"] as? String=="STALE_ACTIVATION_SOURCE" && stable(owner)==afterSame
for index in 0..<20 { _ = owner.command(request(owner,index%2==0 ? "B":"A")) }
checks["repeated-A-B-uses-constant-namespace-counter-not-epoch-history"] = owner.activationNamespace==namespace && owner.activationGeneration==22 && owner.retainedDocumentCount()==2

let invalidOwner = ComposerOwner(8002,nil)
_ = scope(invalidOwner,"invalid-A","seed")
let bad:[String:Any] = ["kind":"reference","source":"unknown-plugin","id":"bad","clipboardText":"@bad","ref":"@bad","label":"bad"]
invalidOwner.text.textStorage?.setAttributedString(invalidOwner.attributed([bad]));invalidOwner.emit("change")
let invalidDigest = draftSemanticDigest(invalidOwner.runs())
_ = scope(invalidOwner,"invalid-B","B")
let invalidRequest = request(invalidOwner,"invalid-A"), invalidAck = invalidOwner.command(invalidRequest)
corpus["invalidRequest"]=invalidRequest;corpus["invalidAck"]=invalidAck;corpus["invalidBody"]=invalidOwner.command(["op":"snapshot","epoch":invalidOwner.epoch,"docKey":invalidOwner.docKey])
checks["invalid-source-hot-body-retained-without-seed-validation-or-overwrite"] = draftSemanticDigest(invalidOwner.runs())==invalidDigest && !invalidOwner.validRuns(invalidOwner.runs()) && invalidAck["kind"] as? String=="hotActivated"

let barrierOwner = ComposerOwner(8003,nil)
_ = scope(barrierOwner,"barrier-B","B")
_ = scope(barrierOwner,"barrier-A","A")
let barrierBefore = barrierOwner.snapshot(), barrierState = stable(barrierOwner)
var highBarrier = request(barrierOwner,"barrier-B");highBarrier["afterRevision"]=barrierOwner.revision+1000
let barrierReply = barrierOwner.command(highBarrier)
corpus["highBarrier"] = ["before":barrierBefore,"request":highBarrier,"reply":barrierReply,"after":barrierOwner.snapshot()]
checks["receiver-barrier-above-native-revision-rejects-before-binding-or-body-mutation"] = barrierReply["error"] as? String=="STALE_ACTIVATION_REVISION" && stable(barrierOwner)==barrierState

// Each consumer is tested as the first semantic read after lazy style fixing.
let prefix=String(repeating:"汉",count:400000), suffix=String(repeating:"x",count:10000)
let chip:[String:Any]=["kind":"reference","source":"reference","id":"first-chip","ref":"@file","clipboardText":"@file","label":"file"]
let expectedRuns:[[String:Any]]=[["kind":"text","text":prefix],chip,["kind":"text","text":suffix]]
let expectedCanonical=prefix+"@file"+suffix, expectedDetect=prefix+"\u{FFFC}"+suffix, expectedDigest=draftSemanticDigest(expectedRuns)
for (index,consumer) in ["runs","canonical","semanticRuns","snapshot"].enumerated() {
    let reader=ComposerOwner(UInt64(8010+index),callback)
    _ = scope(reader,"reader-\(index)","")
    reader.text.textStorage?.setAttributedString(reader.attributed(expectedRuns))
    reader.text.textStorage?.addAttribute(.underlineStyle,value:1,range:NSRange(location:0,length:16000))
    reader.applyGlobalStyle()
    let countBefore=events.count
    var okay=false
    if consumer=="canonical" {okay=reader.canonical()==expectedCanonical}
    else if consumer=="snapshot" {let first=reader.snapshot();okay=first["canonicalText"] as? String==expectedCanonical && first["detectText"] as? String==expectedDetect && first["semanticDigest"] as? String==expectedDigest}
    else {let first=consumer=="runs" ? reader.runs():reader.semanticRuns(reader.text.textStorage!) as! [[String:Any]];okay=draftSemanticDigest(first)==expectedDigest}
    checks["first-\(consumer)-is-partition-independent-with-chip-oversize-and-no-recursive-callback"] = okay && reader.text.string==expectedDetect && events.count==countBefore
    reader.close()
}

let legacy = ComposerOwner(8004,nil)
_ = scope(legacy,"legacy","one");_ = scope(legacy,"legacy","two")
checks["legacy-explicit-scope-behavior-remains-unchanged"] = legacy.canonical()=="two"
let metadataOwner=ComposerOwner(8005,nil)
_ = scope(metadataOwner,"metadata-target","target");_ = scope(metadataOwner,"metadata-source","source")
let saved=metadataOwner.savedDocuments["metadata-target"]!
metadataOwner.savedDocuments["metadata-target"]=RetainedComposerDocument(saved.content,saved.selection,saved.undo,saved.accountScope,0,"bad",saved.appliedCommits)
let metadataBefore=stable(metadataOwner)
checks["invalid-internal-ack-metadata-rejected-before-native-switch"] = metadataOwner.command(request(metadataOwner,"metadata-target"))["error"] as? String=="INVALID_HOT_SEMANTIC_METADATA" && stable(metadataOwner)==metadataBefore

owner.close();invalidOwner.close();barrierOwner.close();legacy.close();metadataOwner.close()
checks["close-retires-hot-documents-undo-binding-and-generation"] = owner.savedDocuments.isEmpty && owner.text.string.isEmpty && owner.docKey.isEmpty && !owner.documentUndo.canUndo && owner.activationNamespace.isEmpty && owner.activationGeneration==0
checks["closed-owner-rejects-activation"] = owner.command(oversizedRequest)["error"] as? String=="CLOSED"
let result:[String:Any] = ["kind":"local-AppKit-hot-activation-program","minimumMacOS":"15.8","HostOrNetwork":false,"checks":checks,"passed":checks.values.filter{$0}.count,"total":checks.count,"corpus":corpus]
let output=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"qa/native-editor-hot-next/build/results.json"
try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:output))
print("hot activation checks \(checks.values.filter{$0}.count)/\(checks.count)")
if checks.values.contains(false) { for (key,value) in checks where !value { print("FAIL \(key)") };exit(1) }
