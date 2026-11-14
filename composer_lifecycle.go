package main

// Called before a selection/account/window discards the composer state. Image
// payload drafts stay scoped; decoded thumbnails and preview textures do not.
func (a *app) releaseComposerImages() {
	if a.composer != nil && a.composer.artifacts != nil {
		a.composer.artifacts.releaseDecodedImages()
	}
}
