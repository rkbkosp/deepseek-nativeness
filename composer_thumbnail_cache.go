package main

import "encoding/base64"

// Reserve CPU bitmap + GPU texture + upload/mipmap overhead. Source compressed
// payloads are independent drafts and remain unchanged for Host admission.
const composerThumbnailBudget = 8 << 20
const composerThumbnailReservation = 160 * 160 * 4 * 3

func (s *composerDraftState) releaseDecodedImages() {
	s.ThumbnailEpoch++
	s.PreviewID = ""
	s.Preview = nil
	for i := range s.Images {
		s.Images[i].Preview = nil
		s.Images[i].ThumbnailLoading = false
		s.Images[i].ThumbnailFailed = false
	}
}
func (s *composerDraftState) evictThumbnails(keep string) {
	count := 0
	for i := range s.Images {
		if s.Images[i].Preview != nil {
			count++
		}
	}
	for count*composerThumbnailReservation > composerThumbnailBudget {
		oldest := -1
		for i := range s.Images {
			img := &s.Images[i]
			if img.Preview != nil && img.ID != keep && (oldest < 0 || img.ThumbnailUsed < s.Images[oldest].ThumbnailUsed) {
				oldest = i
			}
		}
		if oldest < 0 {
			break
		}
		s.Images[oldest].Preview = nil
		count--
	}
}
func (a *app) composerLoadThumbnail(state *composerDraftState, id string) {
	for i := range state.Images {
		img := &state.Images[i]
		if img.ID != id {
			continue
		}
		state.ThumbnailClock++
		img.ThumbnailUsed = state.ThumbnailClock
		if img.Preview != nil || img.ThumbnailLoading || img.ThumbnailFailed || state.ThumbnailWorkers >= 2 {
			return
		}
		img.ThumbnailLoading = true
		state.ThumbnailWorkers++
		data, epoch := img.Data, state.ThumbnailEpoch
		go func() {
			raw, err := base64.StdEncoding.DecodeString(data)
			if err != nil {
				a.update(func() {
					state.ThumbnailWorkers--
					if state.ThumbnailEpoch == epoch {
						for i := range state.Images {
							if state.Images[i].ID == id {
								state.Images[i].ThumbnailLoading = false
								state.Images[i].ThumbnailFailed = true
							}
						}
					}
				})
				return
			}
			thumb, err := composerThumbnail(raw, 160)
			a.update(func() {
				state.ThumbnailWorkers--
				if state.ThumbnailEpoch != epoch {
					return
				}
				for i := range state.Images {
					if state.Images[i].ID == id {
						state.Images[i].ThumbnailLoading = false
						state.Images[i].ThumbnailFailed = err != nil
						if err == nil {
							state.Images[i].Preview = thumb
							state.evictThumbnails(id)
						}
						return
					}
				}
			})
		}()
		return
	}
}
