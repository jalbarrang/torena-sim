//! [`Region`] / [`RegionList`] — half-open interval `[start, end)` **value
//! objects** with the set algebra (intersect, union, subtract, rmap) the skill
//! system samples activation windows over.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::ops::Deref;

/// A half-open interval `[start, end)`.
///
/// An *invalid* region (the result of an empty intersection) is represented by
/// `start == -1.0`; [`RegionList::rmap`] filters these out.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub start: f64,
    pub end: f64,
}

impl Region {
    pub const INVALID: Region = Region {
        start: -1.0,
        end: -1.0,
    };

    pub const fn new(start: f64, end: f64) -> Self {
        Region { start, end }
    }

    /// Intersection of two regions, or [`Region::INVALID`] if they do not
    /// overlap.
    pub fn intersect(&self, other: &Region) -> Region {
        let start = self.start.max(other.start);
        let end = self.end.min(other.end);
        if end <= start {
            Region::INVALID
        } else {
            Region::new(start, end)
        }
    }

    /// Whether `self` fully contains `other`.
    pub fn fully_contains(&self, other: &Region) -> bool {
        self.start <= other.start && self.end >= other.end
    }

    /// A region is valid when it was not produced as an empty intersection.
    pub fn is_valid(&self) -> bool {
        self.start > -1.0
    }

    pub fn len(&self) -> f64 {
        self.end - self.start
    }
}

/// Values that can be produced by an [`RegionList::rmap`] callback — either a
/// single [`Region`] or a collection of them. Mirrors the union return type of
/// the reference TypeScript implementation.
pub trait IntoRegions {
    fn into_regions(self) -> Vec<Region>;
}

impl IntoRegions for Region {
    fn into_regions(self) -> Vec<Region> {
        vec![self]
    }
}

impl IntoRegions for Vec<Region> {
    fn into_regions(self) -> Vec<Region> {
        self
    }
}

impl IntoRegions for RegionList {
    fn into_regions(self) -> Vec<Region> {
        self.0
    }
}

/// An ordered list of [`Region`]s.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RegionList(pub Vec<Region>);

impl RegionList {
    pub fn new() -> Self {
        RegionList(Vec::new())
    }

    pub fn from_vec(v: Vec<Region>) -> Self {
        RegionList(v)
    }

    pub fn push(&mut self, r: Region) {
        self.0.push(r);
    }

    pub fn iter(&self) -> std::slice::Iter<'_, Region> {
        self.0.iter()
    }

    /// Map each region through `f`, flattening and dropping any invalid
    /// ([`Region::INVALID`]) results.
    pub fn rmap<R, F>(&self, mut f: F) -> RegionList
    where
        R: IntoRegions,
        F: FnMut(Region) -> R,
    {
        let mut out = RegionList::new();
        for &r in &self.0 {
            for nr in f(r).into_regions() {
                if nr.is_valid() {
                    out.push(nr);
                }
            }
        }
        out
    }

    /// Union with `other`, merging overlapping/contained regions. The result is
    /// sorted by `start`. Ported to match the reference `reduce`-based
    /// algorithm (which seeds the accumulator with the first element).
    pub fn union(&self, other: &RegionList) -> RegionList {
        let mut united: Vec<Region> = self.0.iter().chain(other.0.iter()).copied().collect();
        united.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(Ordering::Equal));

        let mut out = RegionList::new();
        let Some((&first, rest)) = united.split_first() else {
            return out;
        };

        let mut acc = first;
        for &b in rest {
            if acc.fully_contains(&b) {
                // `b` is subsumed; keep accumulating.
            } else if acc.start <= b.start && b.start < acc.end {
                acc = Region::new(acc.start, b.end);
            } else if acc.start < b.end && b.end <= acc.end {
                acc = Region::new(b.start, acc.end);
            } else {
                out.push(acc);
                acc = b;
            }
        }
        out.push(acc);
        out
    }

    /// Subtract `other` from `self`, returning the remaining segments.
    pub fn subtract(&self, other: &RegionList) -> RegionList {
        // Normalize the excluded set into sorted, non-overlapping regions.
        let excluded = other.union(&RegionList::new());

        let mut out = RegionList::new();
        for &region in &self.0 {
            let mut segments = vec![region];

            for excl in &excluded.0 {
                let mut next: Vec<Region> = Vec::new();
                for seg in &segments {
                    let overlap_start = seg.start.max(excl.start);
                    let overlap_end = seg.end.min(excl.end);

                    if overlap_end <= overlap_start {
                        next.push(*seg);
                        continue;
                    }
                    if seg.start < overlap_start {
                        next.push(Region::new(seg.start, overlap_start));
                    }
                    if overlap_end < seg.end {
                        next.push(Region::new(overlap_end, seg.end));
                    }
                }
                segments = next;
                if segments.is_empty() {
                    break;
                }
            }

            out.0.extend(segments);
        }
        out
    }
}

impl Deref for RegionList {
    type Target = [Region];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl FromIterator<Region> for RegionList {
    fn from_iter<I: IntoIterator<Item = Region>>(iter: I) -> Self {
        RegionList(iter.into_iter().collect())
    }
}

impl<'a> IntoIterator for &'a RegionList {
    type Item = &'a Region;
    type IntoIter = std::slice::Iter<'a, Region>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rl(regions: &[(f64, f64)]) -> RegionList {
        RegionList::from_vec(regions.iter().map(|&(s, e)| Region::new(s, e)).collect())
    }

    #[test]
    fn intersect_overlap_and_disjoint() {
        let a = Region::new(0.0, 10.0);
        assert_eq!(a.intersect(&Region::new(5.0, 20.0)), Region::new(5.0, 10.0));
        assert_eq!(a.intersect(&Region::new(10.0, 20.0)), Region::INVALID);
        assert!(!a.intersect(&Region::new(10.0, 20.0)).is_valid());
    }

    #[test]
    fn fully_contains() {
        let a = Region::new(0.0, 10.0);
        assert!(a.fully_contains(&Region::new(2.0, 8.0)));
        assert!(!a.fully_contains(&Region::new(2.0, 12.0)));
    }

    #[test]
    fn rmap_filters_invalid_and_flattens() {
        let regions = rl(&[(0.0, 10.0), (20.0, 30.0)]);
        let bounds = Region::new(5.0, 25.0);
        let clipped = regions.rmap(|r| r.intersect(&bounds));
        assert_eq!(clipped, rl(&[(5.0, 10.0), (20.0, 25.0)]));

        // A callback returning multiple regions per input.
        let split = rl(&[(0.0, 100.0)]).rmap(|r| {
            vec![
                r.intersect(&Region::new(0.0, 10.0)),
                r.intersect(&Region::new(90.0, 100.0)),
            ]
        });
        assert_eq!(split, rl(&[(0.0, 10.0), (90.0, 100.0)]));
    }

    #[test]
    fn union_merges_overlapping_and_contained() {
        let merged = rl(&[(0.0, 10.0), (5.0, 15.0)]).union(&rl(&[(20.0, 25.0)]));
        assert_eq!(merged, rl(&[(0.0, 15.0), (20.0, 25.0)]));

        let contained = rl(&[(0.0, 30.0)]).union(&rl(&[(10.0, 20.0)]));
        assert_eq!(contained, rl(&[(0.0, 30.0)]));
    }

    #[test]
    fn union_with_empty_normalizes() {
        let normalized = rl(&[(20.0, 25.0), (0.0, 10.0), (5.0, 8.0)]).union(&RegionList::new());
        assert_eq!(normalized, rl(&[(0.0, 10.0), (20.0, 25.0)]));
    }

    #[test]
    fn subtract_punches_holes() {
        let result = rl(&[(0.0, 100.0)]).subtract(&rl(&[(10.0, 20.0), (50.0, 60.0)]));
        assert_eq!(result, rl(&[(0.0, 10.0), (20.0, 50.0), (60.0, 100.0)]));
    }

    #[test]
    fn subtract_empty_is_identity() {
        let original = rl(&[(0.0, 10.0), (20.0, 30.0)]);
        assert_eq!(original.subtract(&RegionList::new()), original);
    }
}
