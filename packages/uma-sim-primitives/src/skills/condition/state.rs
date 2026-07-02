//! Full-sim runner-state dynamic conditions.
//!
//! Port of `full-sim/state-conditions.ts`. These inspect the live state of every
//! active runner (temptation / dueling flags, running style, popularity) through
//! [`RunnerView::active_runners`].

use crate::shared_kernel::language::{strategy_matches, Strategy};
use crate::skills::condition::dynamic::{
    bool_num, compare, register_dynamic_condition, ActiveRunner, DynamicCondition, RunnerView,
};

const POPULARITY_ONE_GATE: i64 = 0;

/// Count active rushed runners matching `predicate`, optionally including self.
fn count_active_rushed(
    runner: &dyn RunnerView,
    include_self: bool,
    predicate: impl Fn(&ActiveRunner) -> bool,
) -> i64 {
    runner
        .active_runners()
        .iter()
        .filter(|other| {
            if !include_self && other.is_self {
                return false;
            }
            other.is_rushed && predicate(other)
        })
        .count() as i64
}

fn count_active_dueling(runner: &dyn RunnerView) -> i64 {
    runner
        .active_runners()
        .iter()
        .filter(|other| other.is_dueling)
        .count() as i64
}

fn has_same_style_as_popularity_one(runner: &dyn RunnerView) -> bool {
    let Some(self_strategy) = runner.strategy() else {
        return false;
    };
    runner
        .active_runners()
        .iter()
        .find(|other| other.gate == POPULARITY_ONE_GATE)
        .is_some_and(|popularity_one| strategy_matches(self_strategy, popularity_one.strategy))
}

fn register_style_temptation_count(name: &'static str, strategy: Strategy) {
    register_style_temptation_count_impl(name, strategy, true);
}

fn register_style_temptation_opponent_count(name: &'static str, strategy: Strategy) {
    register_style_temptation_count_impl(name, strategy, false);
}

fn register_style_temptation_count_impl(
    name: &'static str,
    strategy: Strategy,
    include_self: bool,
) {
    let factory = match (strategy, include_self) {
        (Strategy::FrontRunner, true) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, true, |o| {
                    strategy_matches(o.strategy, Strategy::FrontRunner)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (Strategy::FrontRunner, false) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, false, |o| {
                    strategy_matches(o.strategy, Strategy::FrontRunner)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (Strategy::PaceChaser, true) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, true, |o| {
                    strategy_matches(o.strategy, Strategy::PaceChaser)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (Strategy::PaceChaser, false) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, false, |o| {
                    strategy_matches(o.strategy, Strategy::PaceChaser)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (Strategy::LateSurger, true) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, true, |o| {
                    strategy_matches(o.strategy, Strategy::LateSurger)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (Strategy::LateSurger, false) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, false, |o| {
                    strategy_matches(o.strategy, Strategy::LateSurger)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (_, true) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, true, |o| {
                    strategy_matches(o.strategy, Strategy::EndCloser)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
        (_, false) => |arg, cmp| {
            DynamicCondition::new(move |r| {
                let count = count_active_rushed(r, false, |o| {
                    strategy_matches(o.strategy, Strategy::EndCloser)
                });
                compare(count as f64, arg as f64, cmp)
            })
        },
    };
    register_dynamic_condition(name, factory);
}

/// Register every runner-state dynamic condition.
pub fn register_state_conditions() {
    register_dynamic_condition("is_temptation", |arg, cmp| {
        DynamicCondition::new(move |r| compare(bool_num(r.is_rushed()), arg as f64, cmp))
    });

    register_dynamic_condition("temptation_count", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(
                count_active_rushed(r, true, |_| true) as f64,
                arg as f64,
                cmp,
            )
        })
    });

    register_dynamic_condition("temptation_count_behind", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let position = r.position();
            let count = count_active_rushed(r, false, |o| o.position < position);
            compare(count as f64, arg as f64, cmp)
        })
    });

    // Opponent-only variant; count_active_rushed already excludes self.
    register_dynamic_condition("temptation_opponent_count_behind", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let position = r.position();
            let count = count_active_rushed(r, false, |o| o.position < position);
            compare(count as f64, arg as f64, cmp)
        })
    });

    // arg is the SkillType effect id the opponent's activated skill must carry.
    register_dynamic_condition(
        "is_other_character_activate_advantage_skill",
        |arg, _cmp| {
            DynamicCondition::new(move |r| {
                if !(0..64).contains(&arg) {
                    return false;
                }
                let bit = 1u64 << arg;
                r.active_runners()
                    .iter()
                    .any(|o| !o.is_self && o.activated_advantage_effect_types & bit != 0)
            })
        },
    );

    register_dynamic_condition("temptation_count_infront", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let position = r.position();
            let count = count_active_rushed(r, false, |o| o.position > position);
            compare(count as f64, arg as f64, cmp)
        })
    });

    register_dynamic_condition("temptation_opponent_count_infront", |arg, cmp| {
        DynamicCondition::new(move |r| {
            let position = r.position();
            let count = count_active_rushed(r, false, |o| o.position > position);
            compare(count as f64, arg as f64, cmp)
        })
    });

    register_style_temptation_count("running_style_temptation_count_nige", Strategy::FrontRunner);
    register_style_temptation_count("running_style_temptation_count_senko", Strategy::PaceChaser);
    register_style_temptation_count("running_style_temptation_count_sashi", Strategy::LateSurger);
    register_style_temptation_count("running_style_temptation_count_oikomi", Strategy::EndCloser);
    register_style_temptation_opponent_count(
        "running_style_temptation_opponent_count_nige",
        Strategy::FrontRunner,
    );
    register_style_temptation_opponent_count(
        "running_style_temptation_opponent_count_senko",
        Strategy::PaceChaser,
    );
    register_style_temptation_opponent_count(
        "running_style_temptation_opponent_count_sashi",
        Strategy::LateSurger,
    );
    register_style_temptation_opponent_count(
        "running_style_temptation_opponent_count_oikomi",
        Strategy::EndCloser,
    );

    register_dynamic_condition("running_style_equal_popularity_one", |arg, cmp| {
        DynamicCondition::new(move |r| {
            compare(
                bool_num(has_same_style_as_popularity_one(r)),
                arg as f64,
                cmp,
            )
        })
    });

    register_dynamic_condition("compete_fight_count", |arg, cmp| {
        DynamicCondition::new(move |r| compare(count_active_dueling(r) as f64, arg as f64, cmp))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::condition::dynamic::get_dynamic_condition;
    use crate::skills::condition::operator::CmpKind;

    struct TestRunner {
        position: f64,
        is_rushed: bool,
        strategy: Option<Strategy>,
        runners: Vec<ActiveRunner>,
    }

    impl Default for TestRunner {
        fn default() -> Self {
            TestRunner {
                position: 0.0,
                is_rushed: false,
                strategy: Some(Strategy::FrontRunner),
                runners: Vec::new(),
            }
        }
    }

    impl RunnerView for TestRunner {
        fn position(&self) -> f64 {
            self.position
        }
        fn is_rushed(&self) -> bool {
            self.is_rushed
        }
        fn strategy(&self) -> Option<Strategy> {
            self.strategy
        }
        fn active_runners(&self) -> Vec<ActiveRunner> {
            self.runners.clone()
        }
    }

    fn rival(
        is_self: bool,
        position: f64,
        strategy: Strategy,
        gate: i64,
        rushed: bool,
    ) -> ActiveRunner {
        ActiveRunner {
            is_self,
            position,
            strategy,
            gate,
            is_rushed: rushed,
            is_dueling: false,
            activated_advantage_effect_types: 0,
        }
    }

    #[test]
    fn is_temptation_reflects_self_rushed() {
        register_state_conditions();
        let factory = get_dynamic_condition("is_temptation").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let rushed = TestRunner {
            is_rushed: true,
            ..Default::default()
        };
        assert!(cond.eval(&rushed));
        assert!(!cond.eval(&TestRunner::default()));
    }

    #[test]
    fn temptation_count_includes_self() {
        register_state_conditions();
        let factory = get_dynamic_condition("temptation_count").expect("registered");
        let cond = factory(2, CmpKind::Gte);

        let runner = TestRunner {
            runners: vec![
                rival(true, 100.0, Strategy::FrontRunner, 0, true),
                rival(false, 90.0, Strategy::PaceChaser, 1, true),
                rival(false, 80.0, Strategy::LateSurger, 2, false),
            ],
            ..Default::default()
        };
        assert!(cond.eval(&runner)); // 2 rushed
    }

    #[test]
    fn temptation_count_behind_excludes_self_and_infront() {
        register_state_conditions();
        let factory = get_dynamic_condition("temptation_count_behind").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let runner = TestRunner {
            position: 100.0,
            runners: vec![
                rival(true, 100.0, Strategy::FrontRunner, 0, true), // self ignored
                rival(false, 90.0, Strategy::PaceChaser, 1, true),  // behind, rushed -> counts
                rival(false, 120.0, Strategy::LateSurger, 2, true), // infront -> ignored
            ],
            ..Default::default()
        };
        assert!(cond.eval(&runner));
    }

    #[test]
    fn style_temptation_count_matches_strategy() {
        register_state_conditions();
        let factory =
            get_dynamic_condition("running_style_temptation_count_nige").expect("registered");
        let cond = factory(1, CmpKind::Gte);

        let runner = TestRunner {
            runners: vec![
                rival(false, 90.0, Strategy::Runaway, 1, true), // matches FrontRunner
                rival(false, 80.0, Strategy::LateSurger, 2, true),
            ],
            ..Default::default()
        };
        assert!(cond.eval(&runner));
    }

    #[test]
    fn equal_popularity_one_compares_with_gate_zero_runner() {
        register_state_conditions();
        let factory =
            get_dynamic_condition("running_style_equal_popularity_one").expect("registered");
        let cond = factory(1, CmpKind::Eq);

        let same = TestRunner {
            strategy: Some(Strategy::PaceChaser),
            runners: vec![rival(false, 90.0, Strategy::PaceChaser, 0, false)],
            ..Default::default()
        };
        assert!(cond.eval(&same));

        let different = TestRunner {
            strategy: Some(Strategy::PaceChaser),
            runners: vec![rival(false, 90.0, Strategy::LateSurger, 0, false)],
            ..Default::default()
        };
        assert!(!cond.eval(&different));
    }
}
