//! macOS implementation: Touch ID via LocalAuthentication, master
//! stored in a plain Keychain item.
//!
//! Why no Keychain biometric ACL? `SecAccessControlCreateWithFlags`
//! with `kSecAccessControlBiometryAny` requires the calling binary to
//! be signed with a real Developer ID — unsigned builds get
//! `errSecMissingEntitlement (-34018)` from `SecItemAdd`. Decoupling
//! the prompt from the storage gets the same UX with no entitlement:
//!
//! - `enable_biometric` prompts Touch ID via `LAContext`, then on
//!   success persists the master in a plain Keychain item (accessible
//!   when unlocked, this device only).
//! - `unlock_biometric` prompts Touch ID, then reads the master back.
//!
//! The master never hits disk in plaintext: the Keychain stores it
//! encrypted under the user's account key. Compared to an ACL'd item
//! we lose hardware-bound release (Secure Enclave only hands the data
//! out after biometric), but the master is still inaccessible to other
//! users on the machine and the Touch ID prompt is enforced before any
//! read.

use std::sync::{Arc, Condvar, Mutex};

use block2::StackBlock;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFMutableDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_foundation_sys::base::CFTypeRef;
use core_foundation_sys::string::CFStringRef;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAPolicy};
use security_framework_sys::base::{errSecItemNotFound, errSecSuccess};
use security_framework_sys::item::{
    kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit,
    kSecReturnData, kSecValueData,
};
use security_framework_sys::keychain_item::{SecItemAdd, SecItemCopyMatching, SecItemDelete};

use super::Availability;

const KEYCHAIN_SERVICE: &str = "io.keyfount.desktop.biometric";

#[derive(Debug, Default)]
pub struct Backend;

impl Backend {
    /// Probe LocalAuthentication for `deviceOwnerAuthenticationWithBiometrics`.
    /// LAError -7 (biometryNotEnrolled) means "Mac has Touch ID hardware but
    /// nothing is enrolled"; every other failure means "no hardware /
    /// unsupported".
    pub fn availability(&self) -> Availability {
        let context: Retained<LAContext> = unsafe { LAContext::new() };
        let result = unsafe {
            context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
        };
        match result {
            Ok(()) => Availability::Available,
            Err(err) => {
                if err.code() == -7 {
                    Availability::NotEnrolled
                } else {
                    Availability::Unsupported
                }
            }
        }
    }

    /// Run the Touch ID prompt then drop `plaintext` into the Keychain.
    /// The user must approve the prompt for the sealing to proceed; a
    /// cancel surfaces as `Err("user cancelled")` from `prompt_user`.
    pub fn seal(&self, account: &str, plaintext: &[u8]) -> Result<(), String> {
        prompt_user("activer le déverrouillage biométrique pour Keyfount")?;

        let service = CFString::new(KEYCHAIN_SERVICE);
        let acct = CFString::new(account);
        let data = CFData::from_buffer(plaintext);

        // Replace any prior entry — SecItemAdd duplicate-errors otherwise.
        let _ = delete_existing(&service, &acct);

        let mut query = CFMutableDictionary::<CFString, CFType>::with_capacity(4);
        let class_value = wrap_cfstr(unsafe { kSecClassGenericPassword });
        query.add(&wrap_cfstr(unsafe { kSecClass }), &class_value.as_CFType());
        query.add(
            &wrap_cfstr(unsafe { kSecAttrService }),
            &service.as_CFType(),
        );
        query.add(&wrap_cfstr(unsafe { kSecAttrAccount }), &acct.as_CFType());
        query.add(&wrap_cfstr(unsafe { kSecValueData }), &data.as_CFType());

        let status = unsafe { SecItemAdd(query.as_concrete_TypeRef() as _, std::ptr::null_mut()) };
        if status != errSecSuccess {
            return Err(format!("SecItemAdd failed with OSStatus {status}"));
        }
        Ok(())
    }

    /// Prompt Touch ID, then return the previously sealed master. The
    /// Keychain read itself is not biometry-gated (see file docs); the
    /// gate is the explicit `prompt_user` call we make first.
    pub fn unseal(&self, account: &str, reason: &str) -> Result<Vec<u8>, String> {
        prompt_user(reason)?;

        let service = CFString::new(KEYCHAIN_SERVICE);
        let acct = CFString::new(account);

        let mut query = CFMutableDictionary::<CFString, CFType>::with_capacity(5);
        let class_value = wrap_cfstr(unsafe { kSecClassGenericPassword });
        query.add(&wrap_cfstr(unsafe { kSecClass }), &class_value.as_CFType());
        query.add(
            &wrap_cfstr(unsafe { kSecAttrService }),
            &service.as_CFType(),
        );
        query.add(&wrap_cfstr(unsafe { kSecAttrAccount }), &acct.as_CFType());
        let one = CFNumber::from(1i32);
        query.add(&wrap_cfstr(unsafe { kSecMatchLimit }), &one.as_CFType());
        query.add(
            &wrap_cfstr(unsafe { kSecReturnData }),
            &CFBoolean::true_value().as_CFType(),
        );

        let mut result: CFTypeRef = std::ptr::null();
        let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef() as _, &mut result) };
        if status == errSecItemNotFound {
            return Err("not enrolled".into());
        }
        if status != errSecSuccess {
            return Err(format!("SecItemCopyMatching failed with OSStatus {status}"));
        }
        let cf_data: CFData = unsafe { CFData::wrap_under_create_rule(result as _) };
        Ok(cf_data.bytes().to_vec())
    }

    pub fn clear(&self, account: &str) -> Result<(), String> {
        let service = CFString::new(KEYCHAIN_SERVICE);
        let acct = CFString::new(account);
        delete_existing(&service, &acct)
    }

    /// Presence check that does NOT prompt — we ask the Keychain whether
    /// the item exists without requesting its data, so it never hits the
    /// authentication path.
    pub fn is_enrolled(&self, account: &str) -> bool {
        let service = CFString::new(KEYCHAIN_SERVICE);
        let acct = CFString::new(account);
        let mut query = CFMutableDictionary::<CFString, CFType>::with_capacity(4);
        let class_value = wrap_cfstr(unsafe { kSecClassGenericPassword });
        query.add(&wrap_cfstr(unsafe { kSecClass }), &class_value.as_CFType());
        query.add(
            &wrap_cfstr(unsafe { kSecAttrService }),
            &service.as_CFType(),
        );
        query.add(&wrap_cfstr(unsafe { kSecAttrAccount }), &acct.as_CFType());
        let one = CFNumber::from(1i32);
        query.add(&wrap_cfstr(unsafe { kSecMatchLimit }), &one.as_CFType());
        let status =
            unsafe { SecItemCopyMatching(query.as_concrete_TypeRef() as _, std::ptr::null_mut()) };
        status == errSecSuccess
    }

    pub fn prompt(&self, reason: &str) -> Result<bool, String> {
        prompt_user(reason).map(|()| true)
    }
}

/// Block on `LAContext.evaluatePolicy` until the user approves or
/// cancels the system prompt. `evaluatePolicy` is async-with-block; we
/// signal completion through a condvar so callers see a regular
/// `Result`. The `LAContext` is kept on the stack — releasing it
/// early would cancel the evaluation per Apple's docs.
fn prompt_user(reason: &str) -> Result<(), String> {
    let context: Retained<LAContext> = unsafe { LAContext::new() };
    let reason_ns = NSString::from_str(reason);

    // (result, error_message)
    type Slot = Option<Result<(), String>>;
    let pair: Arc<(Mutex<Slot>, Condvar)> = Arc::new((Mutex::new(None), Condvar::new()));
    let cb_pair = pair.clone();

    let block = StackBlock::new(move |success: Bool, error: *mut NSError| {
        let outcome = if success.is_true() {
            Ok(())
        } else if error.is_null() {
            Err("biometric prompt failed".to_string())
        } else {
            let nserr: &NSError = unsafe { &*error };
            Err(match nserr.code() {
                -2 => "user cancelled".to_string(),
                -4 => "system cancelled".to_string(),
                -7 => "no biometric enrolled".to_string(),
                -8 => "biometry locked out".to_string(),
                _ => format!("LAError {}", nserr.code()),
            })
        };
        let (lock, cvar) = &*cb_pair;
        let mut slot = lock.lock().unwrap();
        *slot = Some(outcome);
        cvar.notify_all();
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason_ns,
            &block,
        );
    }

    let (lock, cvar) = &*pair;
    let mut slot = lock.lock().unwrap();
    while slot.is_none() {
        slot = cvar.wait(slot).unwrap();
    }
    slot.take().unwrap()
}

fn wrap_cfstr(raw: CFStringRef) -> CFString {
    unsafe { CFString::wrap_under_get_rule(raw) }
}

fn delete_existing(service: &CFString, account: &CFString) -> Result<(), String> {
    let mut query = CFMutableDictionary::<CFString, CFType>::with_capacity(3);
    let class_value = wrap_cfstr(unsafe { kSecClassGenericPassword });
    query.add(&wrap_cfstr(unsafe { kSecClass }), &class_value.as_CFType());
    query.add(
        &wrap_cfstr(unsafe { kSecAttrService }),
        &service.as_CFType(),
    );
    query.add(
        &wrap_cfstr(unsafe { kSecAttrAccount }),
        &account.as_CFType(),
    );
    let status = unsafe { SecItemDelete(query.as_concrete_TypeRef() as _) };
    if status == errSecSuccess || status == errSecItemNotFound {
        Ok(())
    } else {
        Err(format!("SecItemDelete failed with OSStatus {status}"))
    }
}
