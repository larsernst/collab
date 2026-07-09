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

class CollabTokenStore {
    companion object {
        private const val TAG = "CollabTokenStore"
        private const val KEY_ALIAS = "collab_server_refresh_tokens_v1"
        private const val PREFS_NAME = "collab_server_refresh_tokens"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128

        @JvmStatic
        fun storeRefreshToken(context: Context, serverUrl: String, refreshToken: String): String? {
            return try {
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
                val ciphertext = cipher.doFinal(refreshToken.toByteArray(StandardCharsets.UTF_8))
                val payload = "${encode(cipher.iv)}.${encode(ciphertext)}"
                context.applicationContext
                    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(preferenceKey(serverUrl), payload)
                    .apply()
                null
            } catch (error: Exception) {
                Log.e(TAG, "Could not store refresh token", error)
                error.message ?: error.javaClass.simpleName
            }
        }

        @JvmStatic
        fun readRefreshToken(context: Context, serverUrl: String): String? {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val key = preferenceKey(serverUrl)
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
                Log.e(TAG, "Could not read refresh token", error)
                prefs.edit().remove(key).apply()
                null
            }
        }

        @JvmStatic
        fun deleteRefreshToken(context: Context, serverUrl: String): String? {
            return try {
                context.applicationContext
                    .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .remove(preferenceKey(serverUrl))
                    .apply()
                null
            } catch (error: Exception) {
                Log.e(TAG, "Could not delete refresh token", error)
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

        private fun preferenceKey(serverUrl: String): String {
            val digest = MessageDigest
                .getInstance("SHA-256")
                .digest(serverUrl.toByteArray(StandardCharsets.UTF_8))
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
