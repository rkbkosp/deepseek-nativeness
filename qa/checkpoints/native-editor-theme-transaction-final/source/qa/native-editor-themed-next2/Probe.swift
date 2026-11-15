import AppKit
import Foundation

// QA-only accessor for the public PlatformView NSView handle. This reads an
// actual external NativeView already mounted by MyGo; no framework internals.
private func readNativeStyle(_ pointer:UnsafeMutableRawPointer,_ includePixels:Bool)->UnsafeMutablePointer<CChar>? {
    precondition(Thread.isMainThread)
    guard let scroll=Unmanaged<AnyObject>.fromOpaque(pointer).takeUnretainedValue() as? NSScrollView,let text=scroll.documentView as? NSTextView else{return strdup("{\"error\":\"not-a-live-composer-view\"}")}
    func hex(_ color:NSColor)->String{guard let c=color.usingColorSpace(.sRGB) else{return "unresolved"};return String(format:"#%02x%02x%02x",Int((c.redComponent*255).rounded()),Int((c.greenComponent*255).rounded()),Int((c.blueComponent*255).rounded()))}
    var report:[String:Any]=["background":hex(scroll.backgroundColor),"clipBackground":hex(scroll.contentView.backgroundColor),"textBackground":hex(text.backgroundColor),"foreground":hex(text.textColor ?? .clear),"appearance":scroll.effectiveAppearance.name.rawValue,"width":scroll.frame.width,"height":scroll.frame.height,"windowAttached":scroll.window != nil,"actualOnscreenPixels":false]
    if let window=scroll.window{report["windowVisible"]=window.isVisible;report["windowKey"]=window.isKeyWindow;report["windowMain"]=window.isMainWindow;report["windowMiniaturized"]=window.isMiniaturized;report["windowOcclusionVisible"]=window.occlusionState.contains(.visible);report["windowOcclusionRaw"]=window.occlusionState.rawValue}
    let width=Int(scroll.bounds.width),height=Int(scroll.bounds.height)
    if includePixels,width>1,height>1,width<=2048,height<=2048 {
        NSGraphicsContext.saveGraphicsState();defer{NSGraphicsContext.restoreGraphicsState()}
        let context=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue|CGBitmapInfo.byteOrder32Big.rawValue)!
        if scroll.isFlipped{context.translateBy(x:0,y:CGFloat(height));context.scaleBy(x:1,y:-1)}
        scroll.displayIgnoringOpacity(scroll.bounds,in:NSGraphicsContext(cgContext:context,flipped:scroll.isFlipped))
        let bytes=context.data!.assumingMemoryBound(to:UInt8.self),offset=(height/2)*width*4+(width*3/4)*4
        report["nativeSubtreePixel"]=(0..<4).map{Int(bytes[offset+$0])}
    }
    let data=try! JSONSerialization.data(withJSONObject:report,options:[.sortedKeys]);return strdup(String(data:data,encoding:.utf8)!)
}
@_cdecl("nd_proof_native_style") public func proofNativeStyle(_ pointer:UnsafeMutableRawPointer)->UnsafeMutablePointer<CChar>?{readNativeStyle(pointer,true)}
@_cdecl("nd_proof_native_props") public func proofNativeProps(_ pointer:UnsafeMutableRawPointer)->UnsafeMutablePointer<CChar>?{readNativeStyle(pointer,false)}
