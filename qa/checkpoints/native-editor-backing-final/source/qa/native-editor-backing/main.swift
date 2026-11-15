import AppKit
import Foundation
let application=NSApplication.shared
final class FixtureHost:NSView {
    var fill=NSColor.white
    override var isFlipped:Bool{true}
    override var isOpaque:Bool{true}
    override func draw(_ r:NSRect){fill.setFill();bounds.fill()}
}
let folder=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
try! FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
var checks=[String:Bool](),samples=[[String:Any]]()
func rgb(_ hex:String)->NSColor{let n=UInt32(hex.dropFirst(),radix:16)!;return NSColor(srgbRed:CGFloat((n>>16)&255)/255,green:CGFloat((n>>8)&255)/255,blue:CGFloat(n&255)/255,alpha:1)}
func capture(_ host:NSView,_ label:String)->[Int]{
    host.layoutSubtreeIfNeeded();host.displayIfNeeded()
    // Render the native subtree directly into an explicit sRGB CGContext.
    // cacheDisplay's default calibrated-RGB representation has a different
    // transfer function and is unsuitable for asserting sRGB byte values.
    let width=Int(host.bounds.width),height=Int(host.bounds.height)
    let bitmap=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
    bitmap.translateBy(x:0,y:CGFloat(height));bitmap.scaleBy(x:1,y:-1)
    let graphics=NSGraphicsContext(cgContext:bitmap,flipped:host.isFlipped)
    host.displayIgnoringOpacity(host.bounds,in:graphics)
    let image=NSBitmapImageRep(cgImage:bitmap.makeImage()!)
    try! image.representation(using:.png,properties:[:])!.write(to:folder.appendingPathComponent(label+".png"))
    // Read the declared sRGB RGBA bytes directly. NSBitmapImageRep.colorAt
    // vends a calibrated NSColor; converting that again changes the gamma.
    let bytes=bitmap.data!.assumingMemoryBound(to:UInt8.self),offset=(height/2)*width*4+(width*3/4)*4
    return (0..<4).map{Int(bytes[offset+$0])}
}
for hostDark in [false,true]{for forcedDark in [false,true]{
    let window=NSWindow(contentRect:NSRect(x:0,y:0,width:600,height:200),styleMask:[.titled],backing:.buffered,defer:false)
    window.appearance=NSAppearance(named:hostDark ? .darkAqua:.aqua)
    let host=FixtureHost(frame:NSRect(x:0,y:0,width:600,height:200));host.fill=hostDark ? rgb("#151517"):.white;window.contentView=host
    let owner=ComposerOwner(100,nil);defer{owner.close();window.close()}
    owner.scroll.frame=host.bounds;host.addSubview(owner.scroll)
    _=owner.command(["op":"scope","docKey":"pixels","epoch":"pixels","runs":[["kind":"text","text":"前🙂 readable "],["kind":"reference","source":"reference","id":"pixel-ref","ref":"@file","label":"中文 file.md","appearance":"file","clipboardText":"@file"]]])
    for alphaCase in [false,true]{
        // These opaque targets are the UI tokens resolved over the intended
        // Go host; the actual Cocoa fixture host is independently light/dark.
        let target=forcedDark ? (alphaCase ? "#313133":"#2c2c2e"):(alphaCase ? "#ebebeb":"#ffffff")
        let style:[String:Any]=["dark":forcedDark,"background":target,"foreground":forcedDark ? "#e0e0e2":"#17181b","accent":forcedDark ? "#9cbdff":"#477be2"]
        _=owner.command(["op":"style","epoch":"pixels","docKey":"pixels","style":style])
        let label="host-\(hostDark ? "dark":"light")-forced-\(forcedDark ? "dark":"light")-\(alphaCase ? "composited-alpha":"opaque")"
        let pixel=capture(host,label),expected=rgb(target).usingColorSpace(.sRGB)!,wanted=[Int((expected.redComponent*255).rounded()),Int((expected.greenComponent*255).rounded()),Int((expected.blueComponent*255).rounded()),255]
        checks[label]=zip(pixel,wanted).allSatisfy{abs($0-$1)<=2}
        samples.append(["case":label,"pixel":pixel,"expected":wanted,"nativeAppearance":owner.scroll.effectiveAppearance.name.rawValue,"clipDrawsBackground":owner.scroll.contentView.drawsBackground,"textDrawsBackground":owner.text.drawsBackground])
    }
    for (index,targetDark) in [false,true,false,true].enumerated(){
        let target=targetDark ? "#2c2c2e":"#ffffff"
        _=owner.command(["op":"style","epoch":"pixels","docKey":"pixels","style":["dark":targetDark,"background":target]])
        let label="host-\(hostDark ? "dark":"light")-initial-\(forcedDark ? "dark":"light")-same-instance-toggle-\(index)"
        let pixel=capture(host,label),wanted=targetDark ? [44,44,46,255]:[255,255,255,255]
        checks[label]=zip(pixel,wanted).allSatisfy{abs($0-$1)<=2};samples.append(["case":label,"pixel":pixel,"expected":wanted])
    }
    let backgroundBefore=owner.style.background
    let rejected=owner.command(["op":"style","epoch":"pixels","docKey":"pixels","style":["dark":false,"background":"#ffffff20"]])
    checks["host-\(hostDark)-initial-\(forcedDark)-unresolved-alpha-rejected"] = rejected["error"] as? String=="OPAQUE_SRGB_BACKGROUND_REQUIRED" && owner.style.background==backgroundBefore
    if !hostDark && forcedDark{
        owner.scroll.drawsBackground=false;owner.scroll.contentView.drawsBackground=false;owner.text.drawsBackground=false
        let pixel=capture(host,"control-dark-appearance-transparent-over-white")
        checks["control-appearance-without-backing-reproduces-white"]=pixel[0]>245 && pixel[1]>245 && pixel[2]>245
        samples.append(["case":"control-transparent-over-white","pixel":pixel])
    }
}}
let result:[String:Any]=["passed":checks.values.allSatisfy{$0},"checks":checks,"samples":samples,"scope":"actual AppKit NSView subtree pixels in explicit light/dark NSWindow hosts; windows never ordered onscreen; no OS/NSApp theme changes; MyGo compositor/CUA acceptance remains pending"]
let data=try! JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]);try! data.write(to:folder.appendingPathComponent("results.json"));print(String(data:data,encoding:.utf8)!);exit(checks.values.allSatisfy{$0} ? 0:1)
