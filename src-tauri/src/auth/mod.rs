use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use thiserror::Error;

pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60); // 15 minutes

#[derive(Error, Debug, PartialEq, Serialize, Deserialize)]
pub enum AuthError {
    #[error("Credentials already configured")]
    AlreadyConfigured,

    #[error("Credentials not configured yet")]
    NotConfigured,

    #[error("Invalid username or password")]
    InvalidCredentials,

    #[error("Account temporarily locked due to repeated failed attempts. Try again in {0} seconds.")]
    AccountLocked(u64),

    #[error("Password must be at least 8 characters long")]
    WeakPassword,

    #[error("Storage error: {0}")]
    StorageError(String),

    #[error("Session expired")]
    SessionExpired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRecord {
    pub username: String,
    pub password_hash: String,
}

pub trait CredentialStore: Send + Sync {
    fn get_credentials(&self) -> Result<Option<CredentialRecord>, String>;
    fn set_credentials(&self, creds: &CredentialRecord) -> Result<(), String>;
    fn delete_credentials(&self) -> Result<(), String>;
    fn store_type(&self) -> &'static str;
}

/// OS Native Keyring store (macOS Keychain, Windows Credential Manager, Linux Secret Service).
pub struct KeyringStore {
    service_name: String,
    account_name: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self {
            service_name: "upsed".to_string(),
            account_name: "admin_credentials".to_string(),
        }
    }
}

impl KeyringStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for KeyringStore {
    fn get_credentials(&self) -> Result<Option<CredentialRecord>, String> {
        let entry = keyring::Entry::new(&self.service_name, &self.account_name)
            .map_err(|e| format!("Keyring init error: {}", e))?;
        match entry.get_password() {
            Ok(json) => {
                let record: CredentialRecord = serde_json::from_str(&json)
                    .map_err(|e| format!("Failed to parse credentials from keyring: {}", e))?;
                Ok(Some(record))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Keyring read error: {}", e)),
        }
    }

    fn set_credentials(&self, creds: &CredentialRecord) -> Result<(), String> {
        let entry = keyring::Entry::new(&self.service_name, &self.account_name)
            .map_err(|e| format!("Keyring init error: {}", e))?;
        let json = serde_json::to_string(creds)
            .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
        entry
            .set_password(&json)
            .map_err(|e| format!("Keyring write error: {}", e))
    }

    fn delete_credentials(&self) -> Result<(), String> {
        let entry = keyring::Entry::new(&self.service_name, &self.account_name)
            .map_err(|e| format!("Keyring init error: {}", e))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keyring delete error: {}", e)),
        }
    }

    fn store_type(&self) -> &'static str {
        "keyring"
    }
}

/// SQLite database fallback store for environments without desktop keyring services.
pub struct DbStore {
    db: Arc<crate::db::Database>,
}

impl DbStore {
    pub fn new(db: Arc<crate::db::Database>) -> Self {
        Self { db }
    }
}

impl CredentialStore for DbStore {
    fn get_credentials(&self) -> Result<Option<CredentialRecord>, String> {
        self.db.get_auth_credentials().map_err(|e| e.to_string())
    }

    fn set_credentials(&self, creds: &CredentialRecord) -> Result<(), String> {
        self.db
            .set_auth_credentials(&creds.username, &creds.password_hash)
            .map_err(|e| e.to_string())
    }

    fn delete_credentials(&self) -> Result<(), String> {
        self.db.delete_auth_credentials().map_err(|e| e.to_string())
    }

    fn store_type(&self) -> &'static str {
        "database"
    }
}

/// Primary: OS Keyring; Fallback: SQLite database.
pub struct FallbackStore {
    keyring: KeyringStore,
    db: DbStore,
}

impl FallbackStore {
    pub fn new(db: Arc<crate::db::Database>) -> Self {
        Self {
            keyring: KeyringStore::new(),
            db: DbStore::new(db),
        }
    }
}

impl CredentialStore for FallbackStore {
    fn get_credentials(&self) -> Result<Option<CredentialRecord>, String> {
        match self.keyring.get_credentials() {
            Ok(Some(creds)) => Ok(Some(creds)),
            Ok(None) => self.db.get_credentials(),
            Err(err) => {
                tracing::warn!(
                    "OS Keyring read failed ({}), falling back to SQLite credential store",
                    err
                );
                self.db.get_credentials()
            }
        }
    }

    fn set_credentials(&self, creds: &CredentialRecord) -> Result<(), String> {
        match self.keyring.set_credentials(creds) {
            Ok(()) => {
                // Ensure no stale creds remain in DB fallback
                let _ = self.db.delete_credentials();
                Ok(())
            }
            Err(err) => {
                tracing::warn!(
                    "OS Keyring write failed ({}), falling back to SQLite credential store",
                    err
                );
                self.db.set_credentials(creds)
            }
        }
    }

    fn delete_credentials(&self) -> Result<(), String> {
        let _ = self.keyring.delete_credentials();
        self.db.delete_credentials()
    }

    fn store_type(&self) -> &'static str {
        "fallback"
    }
}

/// In-memory credential store for isolated testing.
pub struct MemoryStore {
    creds: Arc<Mutex<Option<CredentialRecord>>>,
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self {
            creds: Arc::new(Mutex::new(None)),
        }
    }
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for MemoryStore {
    fn get_credentials(&self) -> Result<Option<CredentialRecord>, String> {
        Ok(self.creds.lock().unwrap().clone())
    }

    fn set_credentials(&self, creds: &CredentialRecord) -> Result<(), String> {
        *self.creds.lock().unwrap() = Some(creds.clone());
        Ok(())
    }

    fn delete_credentials(&self) -> Result<(), String> {
        *self.creds.lock().unwrap() = None;
        Ok(())
    }

    fn store_type(&self) -> &'static str {
        "memory"
    }
}

#[derive(Debug, Clone)]
struct Session {
    username: String,
    last_activity: Instant,
}

#[derive(Debug, Default)]
struct FailureTracker {
    count: u32,
    locked_until: Option<Instant>,
}

pub struct AuthManager {
    store: Box<dyn CredentialStore>,
    session: Mutex<Option<Session>>,
    failures: Mutex<FailureTracker>,
    idle_timeout: Duration,
}

impl AuthManager {
    pub fn new(store: Box<dyn CredentialStore>) -> Self {
        Self {
            store,
            session: Mutex::new(None),
            failures: Mutex::new(FailureTracker::default()),
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
        }
    }

    pub fn new_in_memory() -> Self {
        Self::new(Box::new(MemoryStore::new()))
    }

    pub fn with_idle_timeout(mut self, timeout: Duration) -> Self {
        self.idle_timeout = timeout;
        self
    }

    pub fn is_configured(&self) -> bool {
        self.store
            .get_credentials()
            .ok()
            .flatten()
            .is_some()
    }

    pub fn setup(&self, username: &str, password: &str) -> Result<(), AuthError> {
        let trimmed_user = username.trim();
        if trimmed_user.is_empty() {
            return Err(AuthError::WeakPassword);
        }
        if password.len() < 8 {
            return Err(AuthError::WeakPassword);
        }

        if self.is_configured() {
            return Err(AuthError::AlreadyConfigured);
        }

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| AuthError::StorageError(format!("Argon2 hashing error: {}", e)))?
            .to_string();

        let record = CredentialRecord {
            username: trimmed_user.to_string(),
            password_hash,
        };

        self.store
            .set_credentials(&record)
            .map_err(AuthError::StorageError)?;

        // Immediately authenticate after initial setup
        let mut session = self.session.lock().unwrap();
        *session = Some(Session {
            username: trimmed_user.to_string(),
            last_activity: Instant::now(),
        });

        // Reset any failure tracker
        let mut failures = self.failures.lock().unwrap();
        *failures = FailureTracker::default();

        Ok(())
    }

    pub fn login(&self, username: &str, password: &str) -> Result<(), AuthError> {
        let now = Instant::now();

        // 1. Check brute-force lockout
        {
            let failures = self.failures.lock().unwrap();
            if let Some(locked_until) = failures.locked_until {
                if now < locked_until {
                    let remaining = (locked_until - now).as_secs() + 1;
                    return Err(AuthError::AccountLocked(remaining));
                }
            }
        }

        // 2. Fetch stored credentials
        let stored = self
            .store
            .get_credentials()
            .map_err(AuthError::StorageError)?
            .ok_or(AuthError::NotConfigured)?;

        // 3. Verify username match (case-insensitive)
        let username_matches = stored.username.trim().eq_ignore_ascii_case(username.trim());

        // 4. Verify password with Argon2
        let parsed_hash = PasswordHash::new(&stored.password_hash)
            .map_err(|e| AuthError::StorageError(format!("Corrupt stored hash: {}", e)))?;
        let password_matches = Argon2::default()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok();

        if !username_matches || !password_matches {
            let mut failures = self.failures.lock().unwrap();
            failures.count += 1;
            if failures.count >= 10 {
                failures.locked_until = Some(now + Duration::from_secs(300)); // 5 min lockout
            } else if failures.count >= 5 {
                failures.locked_until = Some(now + Duration::from_secs(30)); // 30s lockout
            }
            return Err(AuthError::InvalidCredentials);
        }

        // Success: Reset failures and create authenticated session
        {
            let mut failures = self.failures.lock().unwrap();
            *failures = FailureTracker::default();
        }

        {
            let mut session = self.session.lock().unwrap();
            *session = Some(Session {
                username: stored.username,
                last_activity: now,
            });
        }

        Ok(())
    }

    pub fn logout(&self) {
        let mut session = self.session.lock().unwrap();
        *session = None;
    }

    pub fn is_authenticated(&self) -> bool {
        let mut session = self.session.lock().unwrap();
        if let Some(ref mut s) = *session {
            if s.last_activity.elapsed() < self.idle_timeout {
                s.last_activity = Instant::now();
                true
            } else {
                // Session expired due to inactivity
                *session = None;
                false
            }
        } else {
            false
        }
    }

    pub fn current_user(&self) -> Option<String> {
        let session = self.session.lock().unwrap();
        session.as_ref().map(|s| s.username.clone())
    }

    pub fn change_password(&self, old_pw: &str, new_pw: &str) -> Result<(), AuthError> {
        if new_pw.len() < 8 {
            return Err(AuthError::WeakPassword);
        }

        let stored = self
            .store
            .get_credentials()
            .map_err(AuthError::StorageError)?
            .ok_or(AuthError::NotConfigured)?;

        let parsed_hash = PasswordHash::new(&stored.password_hash)
            .map_err(|e| AuthError::StorageError(format!("Corrupt stored hash: {}", e)))?;
        Argon2::default()
            .verify_password(old_pw.as_bytes(), &parsed_hash)
            .map_err(|_| AuthError::InvalidCredentials)?;

        let salt = SaltString::generate(&mut OsRng);
        let new_hash = Argon2::default()
            .hash_password(new_pw.as_bytes(), &salt)
            .map_err(|e| AuthError::StorageError(format!("Argon2 hashing error: {}", e)))?
            .to_string();

        let updated = CredentialRecord {
            username: stored.username,
            password_hash: new_hash,
        };

        self.store
            .set_credentials(&updated)
            .map_err(AuthError::StorageError)?;

        // Refresh session last activity
        let mut session = self.session.lock().unwrap();
        if let Some(ref mut s) = *session {
            s.last_activity = Instant::now();
        }

        Ok(())
    }

    pub fn reset(&self) -> Result<(), AuthError> {
        self.store
            .delete_credentials()
            .map_err(AuthError::StorageError)?;
        self.logout();
        let mut failures = self.failures.lock().unwrap();
        *failures = FailureTracker::default();
        Ok(())
    }
}
