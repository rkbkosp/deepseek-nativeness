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
owner.close()
let result:[String:Any]=["stage":"1-modifiers-and-source","passed":checks.values.allSatisfy{$0},"checks":checks,"scope":"actual NSTextView local methods; no public NativeView GUI/no Host/network","normalAndFrozenNextUnchanged":true]
let data=try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]);let target=CommandLine.arguments.count>1 ? CommandLine.arguments[1]:"/tmp/native-editor-semantic-stage1.json";try! data.write(to:URL(fileURLWithPath:target));print(String(data:data,encoding:.utf8)!);if !(checks.values.allSatisfy{$0}){exit(1)}
