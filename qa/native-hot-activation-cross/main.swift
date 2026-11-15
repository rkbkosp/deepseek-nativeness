import AppKit
import Foundation

// Independent component fixture. No NSWindow, visible app, Host, or credentials.
_ = NSApplication.shared
var checks=[String:Bool]()
let ns=String(repeating:"a",count:32)
func seed(_ owner:ComposerOwner,_ key:String,_ body:String,_ account:String="account") {
    _ = owner.command(["op":"scope","docKey":key,"epoch":"cold-"+key,"accountScope":account,"runs":[["kind":"text","text":body]]])
}
func request(_ owner:ComposerOwner,_ target:String,_ account:String="account")->[String:Any] {
    ["op":"activateHot","id":owner.id,"epoch":owner.epoch,"docKey":owner.docKey,"accountScope":owner.accountScope,
     "targetDocKey":target,"targetAccountScope":account,"activationNamespace":ns,
     "expectedActivationGeneration":owner.activationGeneration,"afterRevision":owner.revision]
}
func state(_ owner:ComposerOwner)->[String:String] {
    ["epoch":owner.epoch,"doc":owner.docKey,"account":owner.accountScope,"revision":String(owner.revision),
     "semanticRevision":String(owner.semanticRevision),"digest":owner.semanticDigest,
     "selection":NSStringFromRange(owner.text.selectedRange()),"generation":String(owner.activationGeneration),
     "nativeBody":owner.text.string,"undo":String(owner.documentUndo.canUndo),"saved":String(owner.savedDocuments.count)]
}
let owner=ComposerOwner(7301,nil)
seed(owner,"A","seed-A")
owner.text.insertText(" native-new",replacementRange:NSRange(location:6,length:0))
owner.text.setSelectedRange(NSRange(location:2,length:3))
let newest=owner.canonical(),selection=owner.text.selectedRange(),undo=owner.documentUndo
seed(owner,"B","seed-B")
let first=owner.command(request(owner,"A"))
checks["hot-restores-newest-native-not-stale-seed"] = owner.canonical()==newest && owner.text.selectedRange()==selection && owner.documentUndo === undo
checks["ack-body-free-bounded-and-fenced"] = first["kind"] as? String == "hotActivated" && first["requiresSnapshot"] as? Bool == true && first["runs"]==nil && first["canonicalText"]==nil && (try! JSONSerialization.data(withJSONObject:first)).count<=8192
_ = owner.command(["op":"undo","epoch":owner.epoch,"docKey":owner.docKey])
let undoBody=owner.canonical()
_ = owner.command(["op":"redo","epoch":owner.epoch,"docKey":owner.docKey])
checks["hot-retains-real-undo-redo-document-actions"] = undoBody=="seed-A" && owner.canonical()==newest

let base=state(owner)
var badRequests=[[String:Any]]()
var wrongAccount=request(owner,"B","wrong-account");badRequests.append(wrongAccount)
var oldEpoch=request(owner,"B");oldEpoch["epoch"]="retired";badRequests.append(oldEpoch)
var oldGeneration=request(owner,"B");oldGeneration["expectedActivationGeneration"]=0;badRequests.append(oldGeneration)
var wrongNonce=request(owner,"B");wrongNonce["activationNamespace"]=String(repeating:"b",count:32);badRequests.append(wrongNonce)
var highFence=request(owner,"B");highFence["afterRevision"]=owner.revision+100;badRequests.append(highFence)
var fractional=request(owner,"B");fractional["expectedActivationGeneration"]=Double(owner.activationGeneration)+0.5;badRequests.append(fractional)
var fractionalID=request(owner,"B");fractionalID["id"]=Double(owner.id)+0.5;badRequests.append(fractionalID)
var boolGeneration=request(owner,"B");boolGeneration["expectedActivationGeneration"]=true;badRequests.append(boolGeneration)
var fractionalFence=request(owner,"B");fractionalFence["afterRevision"]=Double(owner.revision)+0.5;badRequests.append(fractionalFence)
let labels=["account","old-epoch","old-generation","nonce","high-invalid-fence","fractional-generation","fractional-id","boolean-generation","fractional-fence"]
for (index,r) in badRequests.enumerated() {
    let result=owner.command(r)
    checks["reject-before-mutation-"+labels[index]] = result["error"] != nil && state(owner)==base && owner.documentUndo === undo
}

// Real native command + Go receiver test consumes this high-fence response.
let barrierBefore=state(owner)
let barrierRequest=request(owner,"B").merging(["afterRevision":owner.revision+100]){_,new in new}
let barrierAck=owner.command(barrierRequest)
let barrierAfter=state(owner)

// Invalid semantic text is retained, not replaced by the adapter's old seed.
owner.text.textStorage!.setAttributedString(NSAttributedString(string:"unsynced\u{FFFC}literal"))
_ = owner.snapshot()
let invalidBody=owner.text.string
_ = owner.command(request(owner,"B"));_ = owner.command(request(owner,"A"))
checks["invalid-body-A-B-A-keeps-native-content"] = owner.text.string==invalidBody

owner.text.textStorage!.setAttributedString(NSAttributedString(string:String(repeating:"x",count:600_000)))
_ = owner.snapshot()
let oversize=boundedComposerJSON(owner.snapshot(),owner:owner)
let oversizeHeader=try! JSONSerialization.jsonObject(with:oversize) as! [String:Any]
checks["oversize-native-produces-bounded-invalid-header"] = oversize.count<=8192 && oversizeHeader["invalid"] as? Bool == true && oversizeHeader["runs"]==nil
_ = owner.command(request(owner,"B"));_ = owner.command(request(owner,"A"))
checks["oversize-body-A-B-A-keeps-native-content"] = owner.text.string.utf16.count==600_000 && owner.text.string.allSatisfy{$0=="x"}
// Restore by native editing, without cold scope/seed.
owner.text.textStorage!.setAttributedString(NSAttributedString(string:"repaired native"))
_ = owner.snapshot();let recovered=owner.command(["op":"snapshot","epoch":owner.epoch,"docKey":owner.docKey])
checks["valid-native-edit-recovers-after-hot-oversize"] = recovered["canonicalText"] as? String == "repaired native"
let nativeView=Unmanaged.passUnretained(owner.scroll).toOpaque()
let start=owner.activationGeneration
for _ in 0..<200 {
    _ = owner.command(request(owner,"B"));_ = owner.command(request(owner,"A"))
}
checks["repeated-A-B-constant-document-count-one-surface"] = owner.retainedDocumentCount()==2 && owner.savedDocuments.count==1 && owner.activationGeneration==start+400 && owner.activationNamespace==ns && Unmanaged.passUnretained(owner.scroll).toOpaque()==nativeView
owner.close()
checks["close-clears-native-bindings-and-nonce"] = owner.docKey.isEmpty && owner.epoch.isEmpty && owner.savedDocuments.isEmpty && owner.activationNamespace.isEmpty && owner.activationGeneration==0
let firstReadOwner=ComposerOwner(7302,{_,_,_ in })
seed(firstReadOwner,"first-A","seed")
firstReadOwner.text.insertText(String(repeating:"汉",count:600_000),replacementRange:NSRange(location:0,length:4))
let originalLargeDigest=firstReadOwner.semanticDigest
seed(firstReadOwner,"first-B","B")
let largeAck=firstReadOwner.command(request(firstReadOwner,"first-A"))
// This MUST be the first attribute enumeration after restoration.
let firstRuns=firstReadOwner.runs(),firstDigest=draftSemanticDigest(firstRuns)
let firstRawUTF16=firstReadOwner.text.string.utf16.count
let secondRuns=firstReadOwner.runs(),secondDigest=draftSemanticDigest(secondRuns)
checks["first-large-restored-read-not-overlapping-or-duplicated"] = firstDigest==originalLargeDigest && firstRuns.reduce(0){$0+($1["text"] as? String ?? "").utf16.count}==600_000
let firstReadDiagnostics:[String:Any] = ["expectedDigest":originalLargeDigest,"ackDigest":largeAck["semanticDigest"] ?? "","firstDigest":firstDigest,"secondDigest":secondDigest,"rawUTF16":firstRawUTF16,"firstPartitions":firstRuns.map{($0["text"] as? String ?? "").utf16.count},"secondPartitions":secondRuns.map{($0["text"] as? String ?? "").utf16.count}]
firstReadOwner.close()
let result:[String:Any] = ["checks":checks,"barrierCase":["request":barrierRequest,"before":barrierBefore,"ack":barrierAck,"after":barrierAfter],"firstReadDiagnostics":firstReadDiagnostics,"gui":false,"host":false]
let output=CommandLine.arguments[1]
try! JSONSerialization.data(withJSONObject:result,options:[.sortedKeys,.prettyPrinted]).write(to:URL(fileURLWithPath:output))
let failed=checks.filter{!$0.value}.map{$0.key}.sorted()
print("Independent native hot activation: \(checks.count-failed.count)/\(checks.count), failed=\(failed)")
if !failed.isEmpty { exit(1) }
