import AppKit
import QuartzCore

// A native component check; it does not connect to Remote or launch a window.
let pointer = indicatorCreate()
let native = Unmanaged<NSView>.fromOpaque(pointer).takeUnretainedValue()
indicatorUpdate(pointer,0.2,0.3,0.4,0.8,1,1,1,1,0,0.375)
let layers = native.layer!.sublayers!
let shapes = layers.compactMap { $0 as? CAShapeLayer }
precondition(shapes.count == 2)
let track = shapes[0]
let arc = shapes[1]
let animation = arc.animation(forKey:"native-dsh-indicator") as! CAKeyframeAnimation
precondition(animation.duration == 1.5 && animation.repeatCount == .infinity)
precondition(animation.values!.count == 181 && animation.keyTimes!.count == 181)
precondition(track.lineWidth == 2 && arc.lineCap == .round)
precondition(!native.acceptsFirstResponder && native.hitTest(.zero) == nil)
native.setFrameSize(NSSize(width:28,height:28))
precondition(abs(track.affineTransform().a - 28.0/24) < 0.0001)
indicatorStop(pointer)
precondition(arc.animationKeys() == nil)
indicatorUpdate(pointer,0.4,0.5,0.6,1,0,0,0,0,0,1.125)
precondition(arc.animationKeys()?.count == 1)
indicatorClose(pointer)
print("Native indicator ABI, cycle, resize, stop and resume passed")
