import AppKit
import Foundation
let application = NSApplication.shared
var checks = [String:Bool]()
var evidence = [String:Any]()
autoreleasepool {
    let owner = ComposerOwner(9100,nil)
    defer { owner.close() }
    let ref:[String:Any] = ["kind":"reference","source":"reference","id":"stable-occurrence","ref":"@[文档](exact-host)","clipboardText":"@[文档](exact-host)","label":"文档😀","appearance":"file"]
    let runs:[[String:Any]] = [["kind":"text","text":"前😀 "],ref,["kind":"text","text":" 后缀"]]
    let first = owner.command(["op":"scope","docKey":"cross-A","epoch":"epoch-A","accountScope":"a","runs":runs,"selection":["start":1,"end":3],"seedSemanticRevision":UInt64(22)])
    checks["cold-scope-restores-emoji-range-and-reference-identity"] = first["error"] == nil && owner.text.selectedRange()==NSRange(location:1,length:2) && owner.runs().contains{$0["id"] as? String=="stable-occurrence"}
    let exported = owner.snapshot()
    let exportedRuns = owner.runs()
    owner.text.insertText("新",replacementRange:NSRange(location:owner.text.string.utf16.count,length:0))
    let changed = owner.canonical()
    let stale = owner.command(["op":"retireDocument","docKey":owner.docKey,"epoch":owner.epoch,"targetDocKey":owner.docKey,"exportedSemanticDigest":exported["semanticDigest"]!])
    checks["stale-retirement-proof-preserves-new-unsent-content"] = stale["error"] as? String=="SEMANTIC_EXPORT_REQUIRED" && owner.canonical()==changed
    _ = owner.command(["op":"scope","docKey":"cross-A","epoch":"restore-before-retire","accountScope":"a","runs":exportedRuns,"selection":["start":1,"end":3],"seedSemanticRevision":UInt64(22)])
    let current = owner.snapshot();let liveRuns = owner.runs()
    let oldUndo = owner.documentUndo
    let retired = owner.command(["op":"retireDocument","docKey":owner.docKey,"epoch":owner.epoch,"targetDocKey":owner.docKey,"exportedSemanticDigest":current["semanticDigest"]!])
    checks["retirement-releases-hot-undo-without-modifying-exported-runs"] = retired["error"] == nil && owner.docKey.isEmpty && !oldUndo.canUndo && liveRuns.contains{$0["id"] as? String=="stable-occurrence"}
    _ = owner.command(["op":"scope","docKey":"cross-A","epoch":"new-owner-epoch","accountScope":"a","runs":liveRuns,"selection":["start":0,"end":3],"seedSemanticRevision":UInt64(22)])
    checks["post-retire-cold-resume-retains-semantic-draft-and-zero-selection-endpoints"] = owner.canonical()=="前😀 @[文档](exact-host) 后缀" && owner.text.selectedRange()==NSRange(location:0,length:3) && !owner.documentUndo.canUndo
    let before = owner.snapshot();let beforeText=owner.canonical()
    let bad = owner.command(["op":"scope","docKey":"bad-object-placeholder","epoch":"bad-epoch","accountScope":"a","runs":[["kind":"text","text":"new\u{FFFC}tail"]]])
    checks["literal-object-placeholder-seed-rejected-without-erasing-current-draft"] = bad["error"] != nil && owner.docKey==before["docKey"] as? String && owner.canonical()==beforeText
    evidence["literalPlaceholderResult"] = ["error":bad["error"] ?? "", "docKey":owner.docKey,"canonicalText":owner.canonical()]
}
let result:[String:Any] = ["checks":checks,"evidence":evidence,"passed":checks.values.allSatisfy{$0},"scope":"actual local AppKit objects only; no windows/GUI actions, Host/network, clipboard, RSS or M1 qualification"]
let data=try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys])
try! data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
print(String(data:data,encoding:.utf8)!)
exit(checks.values.allSatisfy{$0} ? 0:1)
