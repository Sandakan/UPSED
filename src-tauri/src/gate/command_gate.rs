use crate::protocol::{UnlockStage, VoltronicCommand};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Serialize, Deserialize)]
pub enum GateError {
    #[error("Command blocked by safety gate: requires stage {required:?}, current stage is {current:?}")]
    StageLocked {
        required: UnlockStage,
        current: UnlockStage,
    },

    #[error("Cannot advance safety stage: prerequisites not satisfied ({0})")]
    PrerequisiteNotMet(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandGate {
    current_stage: UnlockStage,
    t1_tests_passed: bool,
    t2_tests_passed: bool,
    t3_tests_passed: bool,
}

impl Default for CommandGate {
    fn default() -> Self {
        Self {
            current_stage: UnlockStage::T1ReadOnly,
            t1_tests_passed: false,
            t2_tests_passed: false,
            t3_tests_passed: false,
        }
    }
}

impl CommandGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current_stage(&self) -> UnlockStage {
        self.current_stage
    }

    pub fn set_test_passed(&mut self, stage: UnlockStage) {
        match stage {
            UnlockStage::T1ReadOnly => self.t1_tests_passed = true,
            UnlockStage::T2NonDestructive => self.t2_tests_passed = true,
            UnlockStage::T3ConfigWrite => self.t3_tests_passed = true,
            UnlockStage::T4PowerControl => {}
        }
    }

    /// Verifies if the command is allowed under the current safety unlock stage.
    pub fn check_command(&self, cmd: &VoltronicCommand) -> Result<(), GateError> {
        let required = cmd.required_stage();
        if self.current_stage < required {
            Err(GateError::StageLocked {
                required,
                current: self.current_stage,
            })
        } else {
            Ok(())
        }
    }

    /// Advances the safety unlock stage incrementally.
    pub fn unlock_stage(&mut self, target: UnlockStage) -> Result<(), GateError> {
        match target {
            UnlockStage::T1ReadOnly => {
                self.current_stage = UnlockStage::T1ReadOnly;
                Ok(())
            }
            UnlockStage::T2NonDestructive => {
                if !self.t1_tests_passed {
                    return Err(GateError::PrerequisiteNotMet(
                        "All Stage T1 (Read-Only) tests must pass before unlocking T2".into(),
                    ));
                }
                self.current_stage = UnlockStage::T2NonDestructive;
                Ok(())
            }
            UnlockStage::T3ConfigWrite => {
                if !self.t2_tests_passed {
                    return Err(GateError::PrerequisiteNotMet(
                        "All Stage T2 (Non-Destructive) tests must pass before unlocking T3".into(),
                    ));
                }
                self.current_stage = UnlockStage::T3ConfigWrite;
                Ok(())
            }
            UnlockStage::T4PowerControl => {
                if !self.t3_tests_passed {
                    return Err(GateError::PrerequisiteNotMet(
                        "All Stage T3 (Config Write) tests must pass before unlocking T4".into(),
                    ));
                }
                self.current_stage = UnlockStage::T4PowerControl;
                Ok(())
            }
        }
    }
}

