package com.azazel.collab.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Durable storage for per-vault offline-replica encryption keys.
 *
 * Each key is wrapped with an AndroidKeyStore AES-GCM master key and the
 * ciphertext is persisted in app-private SharedPreferences, so it survives app
 * restarts and device reboots. Durability matters here: losing the key orphans
 * every cached document/asset/CRDT blob and any unsynced offline edits. The
 * store deliberately uses its own KeyStore alias and preferences file, separate
 * from the refresh-token store, so wiping one never affects the other.
 */
class CollabReplicaKeyStore {
    companion object {
        private const val TAG = "CollabReplicaKeyStore"
        private const val KEY_ALIAS = "collab_replica_keys_v1"
        private const val PREFS_NAME = "collab_replica_keys"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128

        @JvmStatic
        fun storeKey(context: Context, account: String, encodedKey: String): String? {
            return try {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
                val ciphertext = cipher.doFinal(encodedKey.toByteArray(StandardCharsets.UTF_8))
                val payload = "${encode(cipher.iv)}.${encode(ciphertext)}"
                context.applicationContext
                    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(preferenceKey(account), payload)
                    .apply()
                null
            } catch (error: Exception) {
                Log.e(TAG, "Could not store replica key", error)
                error.message ?: error.javaClass.simpleName
            }
        }

        @JvmStatic
        fun readKey(context: Context, account: String): String? {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val key = preferenceKey(account)
            val payload = prefs.getString(key, null) ?: return null
            return try {
                val parts = payload.split(".", limit = 2)
                if (parts.size != 2) return null
                val iv = decode(parts[0])
                val ciphertext = decode(parts[1])
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
                String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
            } catch (error: Exception) {
                Log.e(TAG, "Could not read replica key", error)
                prefs.edit().remove(key).apply()
                null
            }
        }

        @JvmStatic
        fun deleteKey(context: Context, account: String): String? {
            return try {
                context.applicationContext
                    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .remove(preferenceKey(account))
                    .apply()
                null
            } catch (error: Exception) {
                Log.e(TAG, "Could not delete replica key", error)
                error.message ?: error.javaClass.simpleName
            }
        }

        private fun getOrCreateKey(): SecretKey {
            val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }

            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            val spec = KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
            generator.init(spec)
            return generator.generateKey()
        }

        private fun preferenceKey(account: String): String {
            val digest = MessageDigest
                .getInstance("SHA-256")
                .digest(account.toByteArray(StandardCharsets.UTF_8))
            return encode(digest)
        }

        private fun encode(bytes: ByteArray): String {
            return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        }

        private fun decode(value: String): ByteArray {
            return Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        }
    }
}
