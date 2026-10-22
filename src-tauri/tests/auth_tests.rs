use std::sync::Arc;
use std::time::Duration;
use upsed_lib::auth::{AuthError, AuthManager};
use upsed_lib::gate::{CommandGate, GateError};
use upsed_lib::protocol::{UnlockStage, VoltronicCommand};

#[test]
fn auth_001_initial_setup_and_login() {
    let auth = AuthManager::new_in_memory();
    assert!(!auth.is_configured());
    assert!(!auth.is_authenticated());

    // Weak password rejected
    let weak_res = auth.setup("admin", "short");
    assert_eq!(weak_res, Err(AuthError::WeakPassword));

    // Valid setup succeeds and immediately logs in
    assert!(auth.setup("admin", "correct-horse-battery").is_ok());
    assert!(auth.is_configured());
    assert!(auth.is_authenticated());
    assert_eq!(auth.current_user(), Some("admin".to_string()));

    // Cannot setup again when already configured
    let duplicate_res = auth.setup("admin2", "new-password-1234");
    assert_eq!(duplicate_res, Err(AuthError::AlreadyConfigured));

    // Logout works
    auth.logout();
    assert!(!auth.is_authenticated());
    assert_eq!(auth.current_user(), None);

    // Login with correct credentials (case-insensitive username)
    assert!(auth.login("ADMIN", "correct-horse-battery").is_ok());
    assert!(auth.is_authenticated());

    // Login with wrong password fails
    auth.logout();
    assert_eq!(
        auth.login("admin", "wrong-password"),
        Err(AuthError::InvalidCredentials)
    );
    assert!(!auth.is_authenticated());
}

#[test]
fn auth_002_brute_force_lockout() {
    let auth = AuthManager::new_in_memory();
    auth.setup("operator", "super-secret-password").unwrap();
    auth.logout();

    // 4 failed attempts: not yet locked
    for _ in 0..4 {
        assert_eq!(
            auth.login("operator", "bad-pass"),
            Err(AuthError::InvalidCredentials)
        );
    }

    // 5th failed attempt: triggers lockout
    assert_eq!(
        auth.login("operator", "bad-pass"),
        Err(AuthError::InvalidCredentials)
    );

    // Subsequent attempt is blocked by lockout
    let lock_res = auth.login("operator", "super-secret-password");
    assert!(matches!(lock_res, Err(AuthError::AccountLocked(_))));
}

#[test]
fn auth_003_idle_session_expiration() {
    // 50ms idle timeout for testing
    let auth = AuthManager::new_in_memory().with_idle_timeout(Duration::from_millis(50));
    auth.setup("admin", "valid-password-123").unwrap();
    assert!(auth.is_authenticated());

    // Active polling within timeout keeps session alive
    std::thread::sleep(Duration::from_millis(20));
    assert!(auth.is_authenticated());

    std::thread::sleep(Duration::from_millis(20));
    assert!(auth.is_authenticated());

    // Inactivity exceeding timeout expires session
    std::thread::sleep(Duration::from_millis(60));
    assert!(!auth.is_authenticated());
}

#[test]
fn auth_004_change_password_and_reset() {
    let auth = AuthManager::new_in_memory();
    auth.setup("admin", "initial-password-123").unwrap();

    // Wrong old password rejected
    assert_eq!(
        auth.change_password("wrong-old", "brand-new-password"),
        Err(AuthError::InvalidCredentials)
    );

    // Weak new password rejected
    assert_eq!(
        auth.change_password("initial-password-123", "tiny"),
        Err(AuthError::WeakPassword)
    );

    // Successful password change
    assert!(auth
        .change_password("initial-password-123", "brand-new-password-123")
        .is_ok());

    auth.logout();
    assert!(auth.login("admin", "initial-password-123").is_err());
    assert!(auth.login("admin", "brand-new-password-123").is_ok());

    // Reset wipes all credentials
    assert!(auth.reset().is_ok());
    assert!(!auth.is_configured());
    assert!(!auth.is_authenticated());
}

#[test]
fn auth_005_command_gate_enforces_auth_barrier() {
    let auth = Arc::new(AuthManager::new_in_memory());
    let gate = CommandGate::with_auth(Arc::clone(&auth));

    // Stage T1 read-only queries ALWAYS permitted, even when unconfigured/unauthenticated
    let t1_cmd = VoltronicCommand::QuickStatus;
    assert_eq!(t1_cmd.required_stage(), UnlockStage::T1ReadOnly);
    assert!(gate.check_command(&t1_cmd).is_ok());
    assert_eq!(gate.current_stage(), UnlockStage::T1ReadOnly);

    // Stage T2 non-destructive actions blocked without auth
    let t2_cmd = VoltronicCommand::TenSecondTest;
    assert_eq!(
        gate.check_command(&t2_cmd),
        Err(GateError::AuthRequired {
            required: UnlockStage::T2NonDestructive
        })
    );

    // Stage T3 configuration writes blocked without auth
    let t3_cmd = VoltronicCommand::SetBypassHighVoltage(240);
    assert_eq!(
        gate.check_command(&t3_cmd),
        Err(GateError::AuthRequired {
            required: UnlockStage::T3ConfigWrite
        })
    );

    // Stage T4 power controls blocked without auth
    let t4_cmd = VoltronicCommand::ShutdownWithDelay { minutes: 0.3 };
    assert_eq!(
        gate.check_command(&t4_cmd),
        Err(GateError::AuthRequired {
            required: UnlockStage::T4PowerControl
        })
    );

    // Authenticate user
    auth.setup("admin", "secure-admin-pass-123").unwrap();
    assert_eq!(gate.current_stage(), UnlockStage::T4PowerControl);

    // Now all stages succeed through the gate
    assert!(gate.check_command(&t1_cmd).is_ok());
    assert!(gate.check_command(&t2_cmd).is_ok());
    assert!(gate.check_command(&t3_cmd).is_ok());
    assert!(gate.check_command(&t4_cmd).is_ok());

    // Logout relocks T2-T4 immediately
    auth.logout();
    assert_eq!(gate.current_stage(), UnlockStage::T1ReadOnly);
    assert!(gate.check_command(&t1_cmd).is_ok());
    assert!(gate.check_command(&t2_cmd).is_err());
    assert!(gate.check_command(&t3_cmd).is_err());
    assert!(gate.check_command(&t4_cmd).is_err());
}
