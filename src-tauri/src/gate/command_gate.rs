use crate::auth::AuthManager;
use crate::protocol::{UnlockStage, VoltronicCommand};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug, PartialEq, Serialize, Deserialize)]
pub enum GateError {
    #[error("Command blocked by safety gate: requires {required:?} privileges; user authentication is required")]
    AuthRequired {
        required: UnlockStage,
    },

    #[error("Command blocked by safety gate: requires stage {required:?}, current stage is {current:?}")]
    StageLocked {
        required: UnlockStage,
        current: UnlockStage,
    },

    #[error("Cannot advance safety stage: prerequisites not satisfied ({0})")]
    PrerequisiteNotMet(String),
}

#[derive(Clone)]
pub struct CommandGate {
    auth: Arc<AuthManager>,
}

impl Default for CommandGate {
    fn default() -> Self {
        Self {
            auth: Arc::new(AuthManager::new_in_memory()),
        }
    }
}

impl std::fmt::Debug for CommandGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CommandGate")
            .field("authenticated", &self.auth.is_authenticated())
            .field("current_stage", &self.current_stage())
            .finish()
    }
}

impl CommandGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_auth(auth: Arc<AuthManager>) -> Self {
        Self { auth }
    }

    /// Creates an authenticated gate in-memory (useful for unit testing stage command executions).
    pub fn new_authenticated() -> Self {
        let auth = Arc::new(AuthManager::new_in_memory());
        let _ = auth.setup("test_admin", "password123");
        Self { auth }
    }

    pub fn current_stage(&self) -> UnlockStage {
        if self.auth.is_authenticated() {
            UnlockStage::T4PowerControl
        } else {
            UnlockStage::T1ReadOnly
        }
    }

    /// Verifies if the command is allowed under the current safety barrier.
    /// Stage T1 queries are strictly non-modifying and always allowed.
    /// Stages T2, T3, and T4 require an active authenticated user session.
    pub fn check_command(&self, cmd: &VoltronicCommand) -> Result<(), GateError> {
        let required = cmd.required_stage();
        if required == UnlockStage::T1ReadOnly {
            return Ok(());
        }

        if self.auth.is_authenticated() {
            Ok(())
        } else {
            Err(GateError::AuthRequired { required })
        }
    }

    /// Compatibility helper for tests and stage resets.
    pub fn set_test_passed(&mut self, _stage: UnlockStage) {}

    /// Compatibility helper: Target T1 relocks (logs out).
    /// Higher targets require authentication.
    pub fn unlock_stage(&mut self, target: UnlockStage) -> Result<(), GateError> {
        if target == UnlockStage::T1ReadOnly {
            self.auth.logout();
            Ok(())
        } else if self.auth.is_authenticated() {
            Ok(())
        } else {
            Err(GateError::AuthRequired { required: target })
        }
    }
}
