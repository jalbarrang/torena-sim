//! Newtype identifier **value objects**.
//!
//! Using newtypes instead of raw `u32`/`String` is a deliberate DDD choice that
//! makes the model self-documenting and prevents mixing unrelated identifiers.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Identity of a `Runner` within a race. Assigned by the `Race` aggregate in
/// insertion order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct RunnerId(pub u32);

impl RunnerId {
    pub fn value(self) -> u32 {
        self.0
    }
}

impl From<u32> for RunnerId {
    fn from(v: u32) -> Self {
        RunnerId(v)
    }
}

impl fmt::Display for RunnerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "runner#{}", self.0)
    }
}

/// Identity of a skill. Skill ids are strings in the source data and may carry a
/// suffix (e.g. `"100012-1"`); [`SkillId::base`] yields the part before the
/// first `-`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SkillId(pub String);

impl SkillId {
    pub fn new(s: impl Into<String>) -> Self {
        SkillId(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The base skill id (everything before the first `-`).
    pub fn base(&self) -> &str {
        self.0.split('-').next().unwrap_or(&self.0)
    }
}

impl From<&str> for SkillId {
    fn from(v: &str) -> Self {
        SkillId(v.to_owned())
    }
}

impl From<String> for SkillId {
    fn from(v: String) -> Self {
        SkillId(v)
    }
}

impl fmt::Display for SkillId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runner_id_roundtrips() {
        let id = RunnerId::from(3u32);
        assert_eq!(id.value(), 3);
        assert_eq!(id, RunnerId(3));
    }

    #[test]
    fn skill_id_base_strips_suffix() {
        assert_eq!(SkillId::from("100012-1").base(), "100012");
        assert_eq!(SkillId::from("202161").base(), "202161");
    }
}
