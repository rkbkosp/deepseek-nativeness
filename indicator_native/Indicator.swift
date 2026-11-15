import AppKit
import QuartzCore

// An embedded view, hosted and clipped by ui.NativeView. Core Animation owns
// the repeating animation; no application timer or display-link is installed.
private final class IndicatorView: NSVisualEffectView {
    private let backing = CALayer()
    private let wash = CAGradientLayer()
    private let track = CAShapeLayer()
    private let arc = CAShapeLayer()
    private var active = false
    private static let paths = (0...180).map { path(Double($0)/180) }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override init(frame: NSRect) {
        super.init(frame: frame)
        material = .sidebar
        blendingMode = .behindWindow
        state = .followsWindowActiveState
        wantsLayer = true
        layer!.addSublayer(backing)
        layer!.addSublayer(wash)
        wash.isHidden = true
        wash.locations = [0,0.35,0.68,1]
        setAccessibilityElement(false)
        for shape in [track, arc] {
            shape.fillColor = nil
            shape.lineWidth = 2
            shape.lineCap = .round
            shape.bounds = CGRect(x:0,y:0,width:24,height:24)
            layer!.addSublayer(shape)
        }
        let circle = CGMutablePath()
        circle.addArc(center:CGPoint(x:12,y:12),radius:9.5,startAngle:0,endAngle:2 * .pi,clockwise:false)
        track.path = circle
        arc.path = Self.paths[0]
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    override var frame: NSRect { didSet { layoutLayers() } }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); layoutLayers() }
    override func viewDidChangeBackingProperties() { super.viewDidChangeBackingProperties(); layoutLayers() }
    override func layout() { super.layout(); layoutLayers() }
    override func setFrameSize(_ size: NSSize) { super.setFrameSize(size); layoutLayers() }
    private func layoutLayers() {
        guard layer != nil else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        backing.frame = convertToLayer(bounds)
        if let host = window?.contentView {
            // The Go sidebar gradient spans the window, not this 14-point view.
            wash.frame = convertToLayer(convert(host.bounds,from:host))
            let top = convertToLayer(CGPoint(x:0,y:0))
            let bottom = convertToLayer(CGPoint(x:0,y:bounds.height))
            wash.startPoint = CGPoint(x:0.5,y:top.y < bottom.y ? 0:1)
            wash.endPoint = CGPoint(x:0.5,y:top.y < bottom.y ? 1:0)
        }
        let center = convertToLayer(CGPoint(x:bounds.midX,y:bounds.midY))
        let top = convertToLayer(CGPoint(x:bounds.minX,y:bounds.minY))
        let bottom = convertToLayer(CGPoint(x:bounds.maxX,y:bounds.maxY))
        for shape in [track,arc] {
            shape.position = center
            shape.setAffineTransform(CGAffineTransform(scaleX:abs(bottom.x-top.x)/24,y:(bottom.y-top.y)/24))
            shape.contentsScale = window?.backingScaleFactor ?? 2
        }
        CATransaction.commit()
    }
    func update(red:Double,green:Double,blue:Double,alpha:Double,br:Double,bg:Double,bb:Double,ba:Double,washMode:UInt,elapsed:Double) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        backing.backgroundColor = CGColor(srgbRed:br,green:bg,blue:bb,alpha:ba)
        let lightWash = washMode == 1
        let darkWash = washMode == 2
        wash.isHidden = !(lightWash || darkWash)
        if !wash.isHidden {
            wash.colors = [CGColor(srgbRed:122.0/255,green:155.0/255,blue:240.0/255,alpha:darkWash ? 0.08:0.1),
                CGColor(srgbRed:122.0/255,green:155.0/255,blue:240.0/255,alpha:0),
                CGColor(srgbRed:143.0/255,green:137.0/255,blue:184.0/255,alpha:0),
                CGColor(srgbRed:143.0/255,green:137.0/255,blue:184.0/255,alpha:darkWash ? 0.07:0.09)]
        }
        track.strokeColor = CGColor(srgbRed:red,green:green,blue:blue,alpha:alpha*0.25)
        arc.strokeColor = CGColor(srgbRed:red,green:green,blue:blue,alpha:alpha)
        if !active {
            let animation = CAKeyframeAnimation(keyPath:"path")
            animation.values = Self.paths
            animation.keyTimes = (0...180).map { NSNumber(value:Double($0)/180) }
            animation.calculationMode = .linear
            animation.duration = 1.5
            animation.repeatCount = .infinity
            animation.beginTime = CACurrentMediaTime()-elapsed
            arc.add(animation,forKey:"native-dsh-indicator")
            active = true
        }
        layoutLayers()
        CATransaction.commit()
    }
    func stop() {
        arc.removeAllAnimations()
        active = false
    }
    static func ease(_ x: Double) -> Double {
        var lo = 0.0, hi = 1.0
        for _ in 0..<18 {
            let u = (lo+hi)/2
            let v = 3*(1-u)*(1-u)*u*0.42 + 3*(1-u)*u*u*0.58 + u*u*u
            if v < x { lo = u } else { hi = u }
        }
        let u = (lo+hi)/2
        return 3*(1-u)*u*u + u*u*u
    }
    static func path(_ phase: Double) -> CGPath {
        let b = ease(phase <= 0.5 ? phase*2 : 2-phase*2)
        let start = phase*2 * .pi + 6*b/9.5
        let length = (12+12*b)/9.5
        let path = CGMutablePath()
        for i in 0...32 {
            let t = start + length*Double(i)/32
            let p = CGPoint(x: 12+9.5*cos(t), y: 12+9.5*sin(t))
            if i == 0 { path.move(to:p) } else { path.addLine(to:p) }
        }
        return path
    }
}
private func view(_ pointer:UnsafeMutableRawPointer) -> IndicatorView {
    Unmanaged<IndicatorView>.fromOpaque(pointer).takeUnretainedValue()
}
@_cdecl("nd_indicator_create")
public func indicatorCreate() -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(IndicatorView(frame:NSRect(x:0,y:0,width:14,height:14))).toOpaque()
}
@_cdecl("nd_indicator_update")
public func indicatorUpdate(_ pointer:UnsafeMutableRawPointer,_ red:Double,_ green:Double,_ blue:Double,_ alpha:Double,_ br:Double,_ bg:Double,_ bb:Double,_ ba:Double,_ washMode:UInt,_ elapsed:Double) {
    view(pointer).update(red:red,green:green,blue:blue,alpha:alpha,br:br,bg:bg,bb:bb,ba:ba,washMode:washMode,elapsed:elapsed)
}
@_cdecl("nd_indicator_stop")
public func indicatorStop(_ pointer:UnsafeMutableRawPointer) { view(pointer).stop() }
@_cdecl("nd_indicator_close")
public func indicatorClose(_ pointer:UnsafeMutableRawPointer) {
    view(pointer).stop()
    Unmanaged<IndicatorView>.fromOpaque(pointer).release()
}
