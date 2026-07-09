const KEYRING_SERVICE: &str = "collab-server";

// Refresh-token storage is per-platform.
//
// Linux defaults to the kernel keyutils keyring: silent (no D-Bus prompt), never
// written to disk, and cleared on reboot, which reconnects the "re-login after a
// reboot" tradeoff. When the user opts into cross-reboot persistence we use the
// D-Bus Secret Service instead, which is durable but may prompt to unlock the
// keyring. `persist_across_reboots` selects the Linux backend; on Windows/macOS
// the native OS keystore (Credential Manager / Keychain) is always used and the
// flag is ignored, because those stores are already silent and durable.

#[cfg(target_os = "linux")]
fn keyutils_entry(server_url: &str) -> Result<keyring::Entry, String> {
    let cred =
        keyring::keyutils::KeyutilsCredential::new_with_target(None, KEYRING_SERVICE, server_url)
            .map_err(|_| "The session keyring is unavailable.".to_string())?;
    Ok(keyring::Entry::new_with_credential(Box::new(cred)))
}

#[cfg(target_os = "linux")]
fn secret_service_entry(server_url: &str) -> Result<keyring::Entry, String> {
    // `new_with_target(None, ..)` uses the "default" target, matching the
    // attributes written by earlier versions (keyring's default builder), so
    // tokens saved before this change are still found on upgrade.
    let cred =
        keyring::secret_service::SsCredential::new_with_target(None, KEYRING_SERVICE, server_url)
            .map_err(|_| "The system keyring (Secret Service) is unavailable.".to_string())?;
    Ok(keyring::Entry::new_with_credential(Box::new(cred)))
}

#[cfg(target_os = "linux")]
pub fn store_refresh_token(
    server_url: &str,
    refresh_token: &str,
    persist_across_reboots: bool,
) -> Result<(), String> {
    if persist_across_reboots {
        secret_service_entry(server_url)?
            .set_password(refresh_token)
            .map_err(|_| "Could not save the server session.".to_string())?;
        // Deleting from keyutils is silent, so clear any stale silent-store copy.
        if let Ok(entry) = keyutils_entry(server_url) {
            let _ = entry.delete_credential();
        }
    } else {
        keyutils_entry(server_url)?
            .set_password(refresh_token)
            .map_err(|_| "Could not save the server session.".to_string())?;
        // Intentionally do NOT touch the Secret Service on this default path:
        // reading or deleting from a locked collection could trigger the unlock
        // prompt this silent path exists to avoid. A stale Secret Service token
        // from a previous opt-in is harmless: silent reconnects ignore it, and
        // explicit disconnect clears both backends.
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn read_refresh_token(server_url: &str, persist_across_reboots: bool) -> Option<String> {
    let keyutils_token = keyutils_entry(server_url)
        .ok()
        .and_then(|entry| entry.get_password().ok());
    if keyutils_token.is_some() || !persist_across_reboots {
        return keyutils_token;
    }
    // Secret Service is durable but can prompt to unlock the desktop keyring, so
    // only read it when the saved server preference explicitly asked for
    // cross-reboot persistence.
    secret_service_entry(server_url)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

#[cfg(target_os = "linux")]
pub fn delete_refresh_token(server_url: &str) {
    if let Ok(entry) = keyutils_entry(server_url) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = secret_service_entry(server_url) {
        let _ = entry.delete_credential();
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn native_entry(server_url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, server_url)
        .map_err(|_| "The operating system credential store is unavailable.".into())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn store_refresh_token(
    server_url: &str,
    refresh_token: &str,
    _persist_across_reboots: bool,
) -> Result<(), String> {
    native_entry(server_url)?
        .set_password(refresh_token)
        .map_err(|_| {
            "Could not save the server session in the operating system credential store.".into()
        })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn read_refresh_token(server_url: &str, _persist_across_reboots: bool) -> Option<String> {
    native_entry(server_url)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn delete_refresh_token(server_url: &str) {
    if let Ok(entry) = native_entry(server_url) {
        let _ = entry.delete_credential();
    }
}

#[cfg(target_os = "android")]
mod android_keystore {
    use jni::objects::{JClass, JObject, JString, JValue};
    use jni::{JNIEnv, JavaVM};
    use std::mem::ManuallyDrop;

    const TOKEN_STORE_CLASS: &str = "com/azazel/collab/companion/CollabTokenStore";

    fn with_env<T>(
        callback: impl for<'local> FnOnce(
            &mut JNIEnv<'local>,
            &JObject<'local>,
        ) -> Result<T, String>,
    ) -> Result<T, String> {
        let context = ndk_context::android_context();
        let java_vm = unsafe { JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "Could not access the Android Java VM.".to_string())?;
        let mut env = java_vm
            .attach_current_thread()
            .map_err(|_| "Could not attach to the Android Java VM.".to_string())?;
        // `ndk_context` owns this global context reference. Borrow it for the
        // JNI call, but do not let `JObject` drop and delete a reference we did
        // not create.
        let context = ManuallyDrop::new(unsafe { JObject::from_raw(context.context().cast()) });
        callback(&mut env, &context)
    }

    fn java_string<'local>(
        env: &mut JNIEnv<'local>,
        value: &str,
    ) -> Result<JObject<'local>, String> {
        env.new_string(value)
            .map(JObject::from)
            .map_err(|_| "Could not create an Android string.".to_string())
    }

    fn token_store_class<'local>(
        env: &mut JNIEnv<'local>,
        context: &JObject<'local>,
    ) -> Result<JClass<'local>, String> {
        let loader = env
            .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .map_err(|_| {
                clear_exception(env);
                "Could not access the Android class loader.".to_string()
            })?
            .l()
            .map_err(|_| "Android returned an invalid class loader.".to_string())?;
        let class_name = java_string(env, "com.azazel.collab.companion.CollabTokenStore")?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&class_name)],
            )
            .map_err(|_| {
                clear_exception(env);
                "Could not load the Android token-store class.".to_string()
            })?
            .l()
            .map_err(|_| "Android returned an invalid token-store class.".to_string())?;
        Ok(JClass::from(class))
    }

    fn string_result(env: &mut JNIEnv<'_>, value: JObject<'_>) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let value = JString::from(value);
        env.get_string(&value)
            .ok()
            .map(|value| value.to_string_lossy().into_owned())
    }

    pub fn store_refresh_token(server_url: &str, refresh_token: &str) -> Result<(), String> {
        with_env(|env, context| {
            let class = token_store_class(env, context)?;
            let server_url = java_string(env, server_url)?;
            let refresh_token = java_string(env, refresh_token)?;
            let error = env
                .call_static_method(
                    class,
                    "storeRefreshToken",
                    "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                    &[
                        JValue::Object(context),
                        JValue::Object(&server_url),
                        JValue::Object(&refresh_token),
                    ],
                )
                .map_err(|_| {
                    clear_exception(env);
                    "Could not save the server session in Android Keystore.".to_string()
                })?
                .l()
                .map_err(|_| {
                    clear_exception(env);
                    "Android Keystore returned an invalid save result.".to_string()
                })?;
            if let Some(error) = string_result(env, error) {
                Err(format!("Could not save the server session in Android Keystore: {error}"))
            } else {
                Ok(())
            }
        })
    }

    pub fn read_refresh_token(server_url: &str) -> Option<String> {
        with_env(|env, context| {
            let class = token_store_class(env, context)?;
            let server_url = java_string(env, server_url)?;
            let value = env
                .call_static_method(
                    class,
                    "readRefreshToken",
                    "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(context), JValue::Object(&server_url)],
                )
                .map_err(|_| {
                    clear_exception(env);
                })
                .ok()
                .and_then(|value| value.l().ok())
                .filter(|value| !value.is_null());
            let Some(value) = value else {
                return Ok(None);
            };
            let value = JString::from(value);
            Ok(env
                .get_string(&value)
                .ok()
                .map(|value| value.to_string_lossy().into_owned()))
        })
        .ok()
        .flatten()
    }

    pub fn delete_refresh_token(server_url: &str) {
        let _ = with_env(|env, context| {
            let class = token_store_class(env, context)?;
            let server_url = java_string(env, server_url)?;
            let _ = env.call_static_method(
                class,
                "deleteRefreshToken",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&server_url)],
            );
            clear_exception(env);
            Ok(())
        });
    }

    fn clear_exception(env: &mut JNIEnv<'_>) {
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
    }
}

#[cfg(target_os = "android")]
pub fn store_refresh_token(
    server_url: &str,
    refresh_token: &str,
    _persist_across_reboots: bool,
) -> Result<(), String> {
    android_keystore::store_refresh_token(server_url, refresh_token)
}

#[cfg(target_os = "android")]
pub fn read_refresh_token(server_url: &str, _persist_across_reboots: bool) -> Option<String> {
    android_keystore::read_refresh_token(server_url)
}

#[cfg(target_os = "android")]
pub fn delete_refresh_token(server_url: &str) {
    android_keystore::delete_refresh_token(server_url)
}

#[cfg(target_os = "ios")]
pub fn store_refresh_token(
    _server_url: &str,
    _refresh_token: &str,
    _persist_across_reboots: bool,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "ios")]
pub fn read_refresh_token(_server_url: &str, _persist_across_reboots: bool) -> Option<String> {
    None
}

#[cfg(target_os = "ios")]
pub fn delete_refresh_token(_server_url: &str) {}
