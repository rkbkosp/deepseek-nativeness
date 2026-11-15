//go:build !darwin

package composer_native

import "errors"

func (*Editor) ActivateHot(HotActivationRequest) (HotActivationAck, error) {
	return HotActivationAck{}, errors.New("native hot activation requires macOS15.8+")
}
