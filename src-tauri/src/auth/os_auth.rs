use crate::auth::AuthError;

pub trait OsAuthenticator: Send + Sync {
    fn is_available(&self) -> bool;
    fn provider_name(&self) -> &'static str;
    fn current_os_user(&self) -> String;
    fn verify_user(&self, reason: &str) -> Result<String, AuthError>;
}

// ---------------------------------------------------------------------------
// macOS Implementation (LocalAuthentication.framework via objc2 / LAContext)
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
pub struct NativeOsAuthenticator;

#[cfg(target_os = "macos")]
impl Default for NativeOsAuthenticator {
    fn default() -> Self {
        Self
    }
}

#[cfg(target_os = "macos")]
impl NativeOsAuthenticator {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "macos")]
impl OsAuthenticator for NativeOsAuthenticator {
    fn is_available(&self) -> bool {
        use objc2::msg_send;
        use objc2::runtime::AnyClass;

        let Some(cls) = AnyClass::get(c"LAContext") else {
            return false;
        };

        unsafe {
            let context: *mut objc2::runtime::AnyObject = msg_send![cls, new];
            if context.is_null() {
                return false;
            }
            // LAPolicyDeviceOwnerAuthentication = 2 (Biometrics OR Apple Watch OR device password)
            let policy: isize = 2;
            let mut error: *mut objc2_foundation::NSError = std::ptr::null_mut();
            let can_evaluate: bool = msg_send![context, canEvaluatePolicy: policy, error: &mut error];
            let _: () = msg_send![context, release];
            can_evaluate
        }
    }

    fn provider_name(&self) -> &'static str {
        "Touch ID / macOS Password"
    }

    fn current_os_user(&self) -> String {
        std::env::var("USER").unwrap_or_else(|_| "admin".to_string())
    }

    fn verify_user(&self, reason: &str) -> Result<String, AuthError> {
        use block2::RcBlock;
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};
        use objc2_foundation::NSString;
        use std::sync::mpsc::channel;

        let Some(cls) = AnyClass::get(c"LAContext") else {
            return Err(AuthError::OsAuthUnavailable(
                "LAContext class not found in LocalAuthentication.framework".into(),
            ));
        };

        let user = self.current_os_user();

        unsafe {
            let context: *mut AnyObject = msg_send![cls, new];
            if context.is_null() {
                return Err(AuthError::OsAuthUnavailable(
                    "Failed to allocate LAContext".into(),
                ));
            }

            let ns_reason = NSString::from_str(reason);
            let policy: isize = 2; // LAPolicyDeviceOwnerAuthentication

            let (tx, rx) = channel::<Result<bool, String>>();
            let tx_cell = std::sync::Mutex::new(Some(tx));
            let reply_block = RcBlock::new(
                move |success: objc2::runtime::Bool, error: *mut AnyObject| {
                    if let Ok(mut lock) = tx_cell.lock() {
                        if let Some(sender) = lock.take() {
                            if success.as_bool() {
                                let _ = sender.send(Ok(true));
                            } else if !error.is_null() {
                                let code: isize = msg_send![error, code];
                                // LAErrorUserCancel = -2, LAErrorSystemCancel = -4, LAErrorAppCancel = -9
                                if code == -2 || code == -4 || code == -9 {
                                    let _ = sender.send(Err("CANCELLED".to_string()));
                                } else {
                                    let desc: *mut NSString = msg_send![error, localizedDescription];
                                    let err_msg = if !desc.is_null() {
                                        (*desc).to_string()
                                    } else {
                                        format!("Authentication failed with code {}", code)
                                    };
                                    let _ = sender.send(Err(err_msg));
                                }
                            } else {
                                let _ = sender.send(Err("Authentication failed".to_string()));
                            }
                        }
                    }
                },
            );

            let _: () = msg_send![
                context,
                evaluatePolicy: policy,
                localizedReason: &*ns_reason,
                reply: &*reply_block
            ];

            let result = rx.recv().map_err(|e| {
                let _: () = msg_send![context, release];
                AuthError::StorageError(format!("OS auth channel closed unexpectedly: {}", e))
            })?;

            let _: () = msg_send![context, release];

            match result {
                Ok(true) => Ok(user),
                Err(err) if err == "CANCELLED" => Err(AuthError::Cancelled),
                Err(err) => Err(AuthError::StorageError(err)),
                _ => Err(AuthError::InvalidCredentials),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Windows Implementation (UserConsentVerifier)
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
pub struct NativeOsAuthenticator;

#[cfg(target_os = "windows")]
impl Default for NativeOsAuthenticator {
    fn default() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
impl NativeOsAuthenticator {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
impl OsAuthenticator for NativeOsAuthenticator {
    fn is_available(&self) -> bool {
        use windows::core::HSTRING;
        use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};

        match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(op) => match op.get() {
                Ok(availability) => availability == UserConsentVerifierAvailability::Available,
                Err(_) => false,
            },
            Err(_) => false,
        }
    }

    fn provider_name(&self) -> &'static str {
        "Windows Hello"
    }

    fn current_os_user(&self) -> String {
        std::env::var("USERNAME").unwrap_or_else(|_| "admin".to_string())
    }

    fn verify_user(&self, reason: &str) -> Result<String, AuthError> {
        use windows::core::HSTRING;
        use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};

        let user = self.current_os_user();
        let prompt = HSTRING::from(reason);

        let op = UserConsentVerifier::RequestVerificationAsync(&prompt)
            .map_err(|e| AuthError::StorageError(format!("Failed to invoke Windows Hello: {}", e)))?;

        let res = op
            .get()
            .map_err(|e| AuthError::StorageError(format!("Windows Hello evaluation error: {}", e)))?;

        match res {
            UserConsentVerificationResult::Verified => Ok(user),
            UserConsentVerificationResult::Canceled => Err(AuthError::Cancelled),
            UserConsentVerificationResult::DeviceNotPresent
            | UserConsentVerificationResult::NotConfiguredForUser
            | UserConsentVerificationResult::DisabledByPolicy
            | UserConsentVerificationResult::DeviceBusy => {
                Err(AuthError::OsAuthUnavailable(format!("{:?}", res)))
            }
            UserConsentVerificationResult::RetriesExhausted => {
                Err(AuthError::InvalidCredentials)
            }
            _ => Err(AuthError::InvalidCredentials),
        }
    }
}

// ---------------------------------------------------------------------------
// Linux / Fallback Implementation (Polkit / pkexec)
// ---------------------------------------------------------------------------
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub struct NativeOsAuthenticator;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl Default for NativeOsAuthenticator {
    fn default() -> Self {
        Self
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl NativeOsAuthenticator {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
impl OsAuthenticator for NativeOsAuthenticator {
    fn is_available(&self) -> bool {
        // Available if pkexec binary exists and display environment is active
        let has_display = std::env::var("DISPLAY").is_ok() || std::env::var("WAYLAND_DISPLAY").is_ok();
        has_display && std::process::Command::new("which")
            .arg("pkexec")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn provider_name(&self) -> &'static str {
        "Linux Polkit"
    }

    fn current_os_user(&self) -> String {
        std::env::var("USER").unwrap_or_else(|_| "admin".to_string())
    }

    fn verify_user(&self, _reason: &str) -> Result<String, AuthError> {
        let user = self.current_os_user();
        let status = std::process::Command::new("pkexec")
            .arg("/bin/true")
            .status()
            .map_err(|e| AuthError::StorageError(format!("Failed to execute pkexec: {}", e)))?;

        if status.success() {
            Ok(user)
        } else if status.code() == Some(126) || status.code() == Some(127) {
            Err(AuthError::Cancelled)
        } else {
            Err(AuthError::InvalidCredentials)
        }
    }
}

// ---------------------------------------------------------------------------
// Mock Authenticator for Unit & Integration Tests
// ---------------------------------------------------------------------------
#[derive(Clone)]
pub struct MockOsAuthenticator {
    available: bool,
    provider: &'static str,
    mock_user: String,
    outcome: Result<(), AuthError>,
}

impl MockOsAuthenticator {
    pub fn available() -> Self {
        Self {
            available: true,
            provider: "Mock OS Biometrics",
            mock_user: "mock_operator".to_string(),
            outcome: Ok(()),
        }
    }

    pub fn unavailable() -> Self {
        Self {
            available: false,
            provider: "None",
            mock_user: "mock_user".to_string(),
            outcome: Err(AuthError::OsAuthUnavailable("No OS biometrics".into())),
        }
    }

    pub fn with_cancellation() -> Self {
        Self {
            available: true,
            provider: "Mock OS Biometrics",
            mock_user: "mock_user".to_string(),
            outcome: Err(AuthError::Cancelled),
        }
    }

    pub fn with_failure() -> Self {
        Self {
            available: true,
            provider: "Mock OS Biometrics",
            mock_user: "mock_user".to_string(),
            outcome: Err(AuthError::InvalidCredentials),
        }
    }
}

impl OsAuthenticator for MockOsAuthenticator {
    fn is_available(&self) -> bool {
        self.available
    }

    fn provider_name(&self) -> &'static str {
        self.provider
    }

    fn current_os_user(&self) -> String {
        self.mock_user.clone()
    }

    fn verify_user(&self, _reason: &str) -> Result<String, AuthError> {
        match &self.outcome {
            Ok(()) => Ok(self.mock_user.clone()),
            Err(e) => Err(e.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_macos_la_context_live() {
        let auth = NativeOsAuthenticator::new();
        let avail = auth.is_available();
        println!(">>> test_macos_la_context_live is_available: {}", avail);
    }
}
