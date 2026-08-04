package main

import "sort"

// Range is a half-open byte interval [Start, End).
type Range struct {
	Start int64 `json:"s"`
	End   int64 `json:"e"`
}

func (r Range) Len() int64 { return r.End - r.Start }

// MergeRange folds one acknowledged interval into a sorted, non-overlapping set.
//
// This mirrors the extension's mergeRange exactly. Both sides must agree on what
// "already on disk" means, because either one may finish a job the other started.
func MergeRange(in []Range, add Range) []Range {
	if add.Len() <= 0 {
		return in
	}
	out := append(append([]Range{}, in...), add)
	sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })

	merged := out[:0]
	for _, r := range out {
		n := len(merged)
		if n > 0 && r.Start <= merged[n-1].End {
			if r.End > merged[n-1].End {
				merged[n-1].End = r.End
			}
			continue
		}
		merged = append(merged, r)
	}
	return merged
}

// MissingRanges returns the gaps in [0, size) not covered by done.
func MissingRanges(done []Range, size int64) []Range {
	var gaps []Range
	cursor := int64(0)
	for _, r := range done {
		if r.Start > cursor {
			gaps = append(gaps, Range{cursor, min64(r.Start, size)})
		}
		if r.End > cursor {
			cursor = r.End
		}
		if cursor >= size {
			break
		}
	}
	if cursor < size {
		gaps = append(gaps, Range{cursor, size})
	}
	return gaps
}

// SplitWork carves the missing ranges into at most n chunks, largest-first, so
// every worker gets useful work and no chunk is pointlessly tiny.
//
// The extension decides n (it measures the host and ramps); the helper only
// executes. Keeping the policy out of here is what lets this binary stay still
// while the extension's strategy keeps improving.
func SplitWork(missing []Range, n int, minChunk int64) []Range {
	if n < 1 {
		n = 1
	}
	var total int64
	for _, r := range missing {
		total += r.Len()
	}
	if total == 0 {
		return nil
	}
	target := total / int64(n)
	if target < minChunk {
		target = minChunk
	}

	var out []Range
	for _, r := range missing {
		for start := r.Start; start < r.End; {
			end := start + target
			// Son parça hedeften küçük kalacaksa onu bölme — tek seferde al.
			if r.End-end < minChunk {
				end = r.End
			}
			if end > r.End {
				end = r.End
			}
			out = append(out, Range{start, end})
			start = end
		}
	}
	return out
}

// Downloaded reports how many bytes the range set covers.
func Downloaded(rs []Range) int64 {
	var n int64
	for _, r := range rs {
		n += r.Len()
	}
	return n
}

// IsComplete reports whether the set covers all of [0, size).
func IsComplete(rs []Range, size int64) bool {
	return size > 0 && len(rs) == 1 && rs[0].Start == 0 && rs[0].End >= size
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
