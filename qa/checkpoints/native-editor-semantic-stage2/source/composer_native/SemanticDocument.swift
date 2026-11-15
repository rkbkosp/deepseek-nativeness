import AppKit
import CryptoKit
import Foundation

var liveComposerOwners=0
var liveComposerSurfaces=0
var liveComposerTextViews=0
var liveComposerUndoManagers=0

final class ComposerScrollView:NSScrollView {
    override init(frame:NSRect){super.init(frame:frame);liveComposerSurfaces += 1}
    required init?(coder:NSCoder){fatalError("Explicit composer construction")}
    deinit{liveComposerSurfaces -= 1}
}
final class ComposerUndoManager:UndoManager {
    override init(){super.init();liveComposerUndoManagers += 1}
    deinit{liveComposerUndoManagers -= 1}
}

// Merge attribute-only text partitions; preserve atomic occurrence identity.
func normalizedDraftRuns(_ input:[[String:Any]])->[[String:Any]] {
    var result=[[String:Any]](),pieces=[String]()
    func flush(){if !pieces.isEmpty{result.append(["kind":"text","text":pieces.joined()]);pieces=[]}}
    for r in input {
        let kind=r["kind"] as? String ?? ""
        if kind=="text"{let text=r["text"] as? String ?? "";if !text.isEmpty{pieces.append(text)};continue}
        flush();var item:[String:Any]=["kind":kind]
        for field in ["id","source","ref","label","appearance","clipboardText"]{if let value=r[field] as? String,!value.isEmpty{item[field]=value}}
        if r["invalid"] as? Bool == true{item["invalid"]=true};result.append(item)
    }
    flush();return result
}
func draftSemanticDigest(_ input:[[String:Any]])->String {
    var data=Data()
    func field(_ value:String){let bytes=Data(value.utf8);var size=UInt32(bytes.count).bigEndian;withUnsafeBytes(of:&size){data.append(contentsOf:$0)};data.append(bytes)}
    field("native-dsh-draft-v1")
    for r in normalizedDraftRuns(input){for key in ["kind","text","id","source","ref","label","appearance","clipboardText"]{field(r[key] as? String ?? "")};field(r["invalid"] as? Bool == true ? "1":"0")}
    return SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()
}

final class RetainedComposerDocument {
    let content:NSAttributedString
    let selection:NSRange
    let undo:UndoManager
    let accountScope:String
    let semanticRevision:UInt64
    let semanticDigest:String
    let appliedCommits:[String:String]
    init(_ content:NSAttributedString,_ selection:NSRange,_ undo:UndoManager,_ accountScope:String,_ semanticRevision:UInt64,_ semanticDigest:String,_ appliedCommits:[String:String]){
        self.content=content;self.selection=selection;self.undo=undo;self.accountScope=accountScope;self.semanticRevision=semanticRevision;self.semanticDigest=semanticDigest;self.appliedCommits=appliedCommits
    }
}

func removeCommittedDraftPrefix(_ current:[[String:Any]],_ sent:[[String:Any]])->[[String:Any]]? {
    var left=normalizedDraftRuns(current);var cursor=0
    for r in normalizedDraftRuns(sent){
        guard cursor<left.count else{return nil}
        if r["kind"] as? String=="text"{
            guard left[cursor]["kind"] as? String=="text",let text=left[cursor]["text"] as? String,let prefix=r["text"] as? String,text.utf8.starts(with:prefix.utf8) else{return nil}
            let rest=String(decoding:text.utf8.dropFirst(prefix.utf8.count),as:UTF8.self)
            if rest.isEmpty{cursor += 1}else{left[cursor]=["kind":"text","text":rest]}
        }else{guard draftSemanticDigest([left[cursor]])==draftSemanticDigest([r]) else{return nil};cursor += 1}
    }
    return Array(left.dropFirst(cursor))
}
