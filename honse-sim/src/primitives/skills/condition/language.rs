//! The Pratt parser **domain service**: tokenizer + precedence grammar that
//! turns a condition string into an operator tree.
//!
//! Ports `parser/ConditionParser.ts`. The grammar (no parentheses, no other
//! precedence control):
//!
//! ```text
//! Or  ::= And '@' Or  | And
//! And ::= Cmp '&' And | Cmp
//! Cmp ::= condition Op integer
//! Op  ::= '==' | '!=' | '>' | '>=' | '<' | '<='
//! ```
//!
//! Binding powers: `Or` = 10, `And` = 20, comparison = 30.

use std::sync::Arc;

use crate::skills::condition::operator::{AndOperator, CmpKind, CmpOperator, OrOperator};
use crate::skills::condition::{Condition, ConditionCatalog, ConditionError, Operator};

const OR_BP: u8 = 10;
const AND_BP: u8 = 20;
const CMP_BP: u8 = 30;

/// A parse failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// Input ended where more tokens were expected.
    UnexpectedEof,
    /// A `nud` position contained a token that cannot start an expression.
    ExpectedExpression,
    /// Left side of a comparison was not a condition.
    ExpectedConditionLhs,
    /// Right side of a comparison was not an integer.
    ExpectedNumberRhs,
    /// An operand of a logical operator was not a comparison/operator.
    ExpectedOperatorOperand,
    /// An identifier did not resolve to a known condition.
    UnknownCondition(String),
    /// A `=` was not followed by `=`.
    ExpectedEquals,
    /// An invalid character was encountered.
    InvalidCharacter(char),
    /// The top-level expression was not an operator.
    ExpectedOperator,
    /// Building an operator failed (e.g. incompatible sample policies).
    Operator(ConditionError),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::UnexpectedEof => write!(f, "unexpected eof"),
            ParseError::ExpectedExpression => write!(f, "expected expression"),
            ParseError::ExpectedConditionLhs => {
                write!(f, "expected condition on left hand side of comparison")
            }
            ParseError::ExpectedNumberRhs => {
                write!(f, "expected number on right hand side of comparison")
            }
            ParseError::ExpectedOperatorOperand => {
                write!(f, "expected comparison on side of logical operator")
            }
            ParseError::UnknownCondition(name) => write!(f, "unknown condition '{name}'"),
            ParseError::ExpectedEquals => write!(f, "expected ="),
            ParseError::InvalidCharacter(c) => write!(f, "invalid character '{c}'"),
            ParseError::ExpectedOperator => write!(f, "expected comparison or operator"),
            ParseError::Operator(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for ParseError {}

impl From<ConditionError> for ParseError {
    fn from(err: ConditionError) -> Self {
        ParseError::Operator(err)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    Int(i64),
    Ident(String),
    Cmp(CmpKind),
    And,
    Or,
}

impl Token {
    fn lbp(&self) -> u8 {
        match self {
            Token::Int(_) | Token::Ident(_) => 0,
            Token::Cmp(_) => CMP_BP,
            Token::And => AND_BP,
            Token::Or => OR_BP,
        }
    }
}

fn is_digit(b: u8) -> bool {
    b.is_ascii_digit()
}

fn is_identifier(b: u8) -> bool {
    b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'
}

fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let bytes = input.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if is_digit(c) {
            let mut value: i64 = 0;
            while i < bytes.len() && is_digit(bytes[i]) {
                value = value * 10 + i64::from(bytes[i] - b'0');
                i += 1;
            }
            tokens.push(Token::Int(value));
        } else if is_identifier(c) {
            let start = i;
            while i < bytes.len() && is_identifier(bytes[i]) {
                i += 1;
            }
            tokens.push(Token::Ident(input[start..i].to_owned()));
        } else {
            match c {
                b'=' => {
                    i += 1;
                    if bytes.get(i) != Some(&b'=') {
                        return Err(ParseError::ExpectedEquals);
                    }
                    i += 1;
                    tokens.push(Token::Cmp(CmpKind::Eq));
                }
                b'!' => {
                    i += 1;
                    if bytes.get(i) != Some(&b'=') {
                        return Err(ParseError::ExpectedEquals);
                    }
                    i += 1;
                    tokens.push(Token::Cmp(CmpKind::Neq));
                }
                b'<' => {
                    i += 1;
                    if bytes.get(i) == Some(&b'=') {
                        i += 1;
                        tokens.push(Token::Cmp(CmpKind::Lte));
                    } else {
                        tokens.push(Token::Cmp(CmpKind::Lt));
                    }
                }
                b'>' => {
                    i += 1;
                    if bytes.get(i) == Some(&b'=') {
                        i += 1;
                        tokens.push(Token::Cmp(CmpKind::Gte));
                    } else {
                        tokens.push(Token::Cmp(CmpKind::Gt));
                    }
                }
                b'@' => {
                    i += 1;
                    tokens.push(Token::Or);
                }
                b'&' => {
                    i += 1;
                    tokens.push(Token::And);
                }
                _ => return Err(ParseError::InvalidCharacter(c as char)),
            }
        }
    }
    Ok(tokens)
}

/// A parsed AST node.
enum Node {
    Int(i64),
    Cond(Arc<dyn Condition>),
    Op(Box<dyn Operator>),
}

struct TokenStream {
    tokens: Vec<Token>,
    pos: usize,
}

impl TokenStream {
    fn advance(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.pos).cloned();
        if token.is_some() {
            self.pos += 1;
        }
        token
    }

    fn peek_lbp(&self) -> u8 {
        self.tokens.get(self.pos).map_or(0, Token::lbp)
    }
}

/// The condition-string parser, bound to a [`ConditionCatalog`].
pub struct ConditionParser<'c> {
    catalog: &'c ConditionCatalog,
}

impl<'c> ConditionParser<'c> {
    /// Build a parser over the given catalog.
    pub fn new(catalog: &'c ConditionCatalog) -> Self {
        ConditionParser { catalog }
    }

    /// Parse a condition string into an operator tree, erroring if the result is
    /// not an operator (e.g. a bare condition or integer).
    pub fn parse(&self, condition: &str) -> Result<Box<dyn Operator>, ParseError> {
        match self.parse_node(condition)? {
            Node::Op(op) => Ok(op),
            _ => Err(ParseError::ExpectedOperator),
        }
    }

    fn parse_node(&self, condition: &str) -> Result<Node, ParseError> {
        let mut stream = TokenStream {
            tokens: tokenize(condition)?,
            pos: 0,
        };
        self.expression(&mut stream, 0)
    }

    fn expression(&self, stream: &mut TokenStream, rbp: u8) -> Result<Node, ParseError> {
        let token = stream.advance().ok_or(ParseError::UnexpectedEof)?;
        let mut left = self.nud(token)?;
        while rbp < stream.peek_lbp() {
            let token = stream.advance().ok_or(ParseError::UnexpectedEof)?;
            left = self.led(stream, &token, left)?;
        }
        Ok(left)
    }

    /// Null denotation: how a token behaves at the start of an expression.
    fn nud(&self, token: Token) -> Result<Node, ParseError> {
        match token {
            Token::Int(value) => Ok(Node::Int(value)),
            Token::Ident(name) => self
                .catalog
                .get(&name)
                .map(|cond| Node::Cond(Arc::clone(cond)))
                .ok_or(ParseError::UnknownCondition(name)),
            Token::Cmp(_) | Token::And | Token::Or => Err(ParseError::ExpectedExpression),
        }
    }

    /// Left denotation: how a token combines with the expression on its left.
    fn led(&self, stream: &mut TokenStream, token: &Token, left: Node) -> Result<Node, ParseError> {
        match token {
            Token::Cmp(kind) => {
                let Node::Cond(cond) = left else {
                    return Err(ParseError::ExpectedConditionLhs);
                };
                let right = self.expression(stream, CMP_BP)?;
                let Node::Int(value) = right else {
                    return Err(ParseError::ExpectedNumberRhs);
                };
                Ok(Node::Op(Box::new(CmpOperator::new(cond, value, *kind))))
            }
            Token::And => {
                let left = Self::expect_op(left)?;
                let right = Self::expect_op(self.expression(stream, AND_BP)?)?;
                Ok(Node::Op(Box::new(AndOperator::new(left, right)?)))
            }
            Token::Or => {
                let left = Self::expect_op(left)?;
                let right = Self::expect_op(self.expression(stream, OR_BP)?)?;
                Ok(Node::Op(Box::new(OrOperator::new(left, right)?)))
            }
            Token::Int(_) | Token::Ident(_) => Err(ParseError::ExpectedExpression),
        }
    }

    fn expect_op(node: Node) -> Result<Box<dyn Operator>, ParseError> {
        match node {
            Node::Op(op) => Ok(op),
            _ => Err(ParseError::ExpectedOperatorOperand),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::model::CourseData;
    use crate::shared_kernel::language::{DistanceType, Mood, Orientation, Strategy, Surface};
    use crate::shared_kernel::language::{Grade, GroundCondition, Season, TimeOfDay, Weather};
    use crate::shared_kernel::params::{RaceParameters, StatLine};
    use crate::shared_kernel::region::{Region, RegionList};
    use crate::skills::activation::ActivationSamplePolicy;
    use crate::skills::condition::dynamic::{DynamicCondition, RunnerView};
    use crate::skills::condition::{
        ApplyParams, Condition, ConditionError, ConditionFilterParams, ConditionResolution,
        ConditionResult, SkillEvalRunner,
    };

    /// Test condition: passes all regions through; sample policy is configurable.
    /// When `dynamic` is set, attaches an always-true dynamic condition so we can
    /// exercise the `Option<DynamicCondition>` combination path.
    struct TestCond {
        policy: ActivationSamplePolicy,
        dynamic: bool,
    }

    impl TestCond {
        #[allow(
            clippy::unnecessary_wraps,
            reason = "test helper mirrors the fallible production signature it stands in for"
        )]
        fn result(
            &self,
            params: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            let cond = if self.dynamic {
                Some(DynamicCondition::new(|_| true))
            } else {
                None
            };
            Ok((params.regions.clone(), cond))
        }
    }

    impl Condition for TestCond {
        fn sample_policy(&self) -> ActivationSamplePolicy {
            self.policy
        }
        fn filter_eq(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
        fn filter_neq(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
        fn filter_lt(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
        fn filter_lte(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
        fn filter_gt(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
        fn filter_gte(
            &self,
            p: &ConditionFilterParams<'_>,
        ) -> Result<ConditionResult, ConditionError> {
            self.result(p)
        }
    }

    fn catalog() -> ConditionCatalog {
        let mut map = ConditionCatalog::new();
        let immediate = |dynamic: bool| -> Arc<dyn Condition> {
            Arc::new(TestCond {
                policy: ActivationSamplePolicy::Immediate,
                dynamic,
            })
        };
        map.insert("phase".to_owned(), immediate(false));
        map.insert("order_rate".to_owned(), immediate(false));
        map.insert("accumulatetime".to_owned(), immediate(true));
        map.insert(
            "corner_random".to_owned(),
            Arc::new(TestCond {
                policy: ActivationSamplePolicy::CornerRandom,
                dynamic: false,
            }),
        );
        map
    }

    fn course() -> CourseData {
        CourseData {
            course_id: 1,
            race_track_id: 1,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: vec![],
            corners: vec![],
            straights: vec![],
            slopes: vec![],
            lane_max: 10.0,
            course_width: 30.0,
            horse_lane: 1.5,
            lane_change_acceleration: 0.0,
            lane_change_acceleration_per_frame: 0.0,
            max_lane_distance: 0.0,
            move_lane_point: 0.0,
            is_abroad: false,
        }
    }

    fn runner() -> SkillEvalRunner {
        SkillEvalRunner {
            base_stats: StatLine {
                speed: 1000,
                stamina: 1000,
                power: 1000,
                guts: 1000,
                wit: 1000,
            },
            strategy: Strategy::PaceChaser,
            mood: Mood::Normal,
            popularity: 0,
        }
    }

    fn params() -> RaceParameters {
        RaceParameters {
            ground: GroundCondition::Firm,
            weather: Weather::Sunny,
            season: Season::Spring,
            time_of_day: TimeOfDay::Midday,
            grade: Grade::G1,
            num_umas: Some(9),
            order_range: None,
            skill_id: None,
            strategy_counts: None,
            common_skills: None,
        }
    }

    struct DummyRunner;
    impl RunnerView for DummyRunner {}

    #[test]
    fn parses_simple_comparison() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        let op = parser.parse("phase>=2").expect("parse");
        assert_eq!(op.sample_policy(), ActivationSamplePolicy::Immediate);
    }

    #[test]
    fn parses_conjunction_and_reconciles_policy() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        let op = parser.parse("phase>=2&order_rate<=50").expect("parse");
        assert_eq!(op.sample_policy(), ActivationSamplePolicy::Immediate);
    }

    #[test]
    fn corner_random_or_resolves_to_first_branch() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        let op = parser
            .parse("corner_random==1@corner_random==2")
            .expect("parse");
        assert_eq!(op.sample_policy(), ActivationSamplePolicy::CornerRandom);

        let course = course();
        let runner = runner();
        let extra = params();
        let regions = RegionList::from_vec(vec![Region::new(0.0, 100.0)]);
        let apply = ApplyParams {
            regions,
            course: &course,
            runner: &runner,
            extra: &extra,
            resolution: ConditionResolution::Dynamic,
        };
        let (out_regions, cond) = op.apply(&apply).expect("apply");
        // First (non-empty) branch wins; no dynamic condition.
        assert_eq!(out_regions.0, vec![Region::new(0.0, 100.0)]);
        assert!(cond.is_none());
    }

    #[test]
    fn parses_nested_mixed_expression() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        parser
            .parse("phase>=2&order_rate<=50@phase==1")
            .expect("parse");
    }

    #[test]
    fn and_combines_dynamic_conditions() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        let op = parser.parse("phase>=2&accumulatetime>=20").expect("parse");
        let course = course();
        let runner = runner();
        let extra = params();
        let apply = ApplyParams {
            regions: RegionList::from_vec(vec![Region::new(0.0, 2400.0)]),
            course: &course,
            runner: &runner,
            extra: &extra,
            resolution: ConditionResolution::Dynamic,
        };
        let (_, cond) = op.apply(&apply).expect("apply");
        // accumulatetime is dynamic, so a combined condition is produced.
        let cond = cond.expect("dynamic condition");
        assert!(cond.eval(&DummyRunner));
    }

    #[test]
    fn error_cases() {
        let cat = catalog();
        let parser = ConditionParser::new(&cat);
        let err = |s: &str| parser.parse(s).err().expect("expected parse error");
        assert_eq!(err("phase>="), ParseError::UnexpectedEof);
        assert_eq!(err("2>=2"), ParseError::ExpectedConditionLhs);
        assert_eq!(err("phase>=phase"), ParseError::ExpectedNumberRhs);
        assert_eq!(
            err("foobar==1"),
            ParseError::UnknownCondition("foobar".to_owned())
        );
        assert_eq!(
            err("phase>=1&order_rate"),
            ParseError::ExpectedOperatorOperand
        );
        assert_eq!(err("phase#1"), ParseError::InvalidCharacter('#'));
        // A bare condition is not an operator.
        assert_eq!(err("phase"), ParseError::ExpectedOperator);
    }
}
