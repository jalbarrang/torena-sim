//! Runtime ledger of successfully-activated skills, keyed by base skill id.
//!
//! Usage 14 (`MultiplyActivateSpecificTagSkillCount`) scales an effect by the
//! number of activated skills carrying an authoritative "green" master-data tag
//! (601–615). This value object records each successful activation once by base
//! skill id and answers that count without double-counting a skill that carries
//! several matching tags or that activates more than once.
//!
//! It is deliberately tag-driven: green status comes from master-data tags, not
//! from effect types 1–5 or an "always active" heuristic.

use std::collections::HashSet;

/// Inclusive master-data tag range that marks a skill as a counted green.
pub const GREEN_TAG_RANGE: std::ops::RangeInclusive<i32> = 601..=615;

/// Records activated skills and counts those carrying a green tag.
#[derive(Debug, Clone, Default)]
pub struct ActivatedSkillLedger {
    /// Base skill ids that activated *and* carried at least one green tag.
    green_skill_ids: HashSet<String>,
}

impl ActivatedSkillLedger {
    /// A fresh, empty ledger.
    pub fn new() -> Self {
        Self::default()
    }

    /// Forget all recorded activations (called at the start of each round).
    pub fn clear(&mut self) {
        self.green_skill_ids.clear();
    }

    /// Record a successful activation. Only skills carrying a green tag are
    /// retained, and a skill is retained once regardless of how many green tags
    /// it carries or how many times it activates.
    pub fn record(&mut self, base_skill_id: &str, tags: &[i32]) {
        if tags.iter().any(|tag| GREEN_TAG_RANGE.contains(tag)) {
            self.green_skill_ids.insert(base_skill_id.to_owned());
        }
    }

    /// How many distinct activated skills carry a green tag.
    pub fn activated_green_count(&self) -> usize {
        self.green_skill_ids.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_green_tagged_activations() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("100001", &[401, 405]); // no green tag
        ledger.record("200011", &[401, 608]); // green
        assert_eq!(ledger.activated_green_count(), 1);
    }

    #[test]
    fn multi_green_tag_skill_counts_once() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("200011", &[601, 608, 610]);
        assert_eq!(ledger.activated_green_count(), 1);
    }

    #[test]
    fn repeat_activation_of_same_skill_counts_once() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("200011", &[608]);
        ledger.record("200011", &[608]);
        assert_eq!(ledger.activated_green_count(), 1);
    }

    #[test]
    fn distinct_green_skills_accumulate() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("200011", &[608]);
        ledger.record("200191", &[603]);
        ledger.record("200211", &[602]);
        assert_eq!(ledger.activated_green_count(), 3);
    }

    #[test]
    fn boundary_tags_601_and_615_count_but_600_and_616_do_not() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("a", &[600]);
        ledger.record("b", &[616]);
        assert_eq!(ledger.activated_green_count(), 0);
        ledger.record("c", &[601]);
        ledger.record("d", &[615]);
        assert_eq!(ledger.activated_green_count(), 2);
    }

    #[test]
    fn clear_resets_the_ledger() {
        let mut ledger = ActivatedSkillLedger::new();
        ledger.record("200011", &[608]);
        ledger.clear();
        assert_eq!(ledger.activated_green_count(), 0);
    }
}
