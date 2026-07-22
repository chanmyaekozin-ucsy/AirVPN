package com.airvpn.app.util

import android.util.Base64
import com.airvpn.app.BuildConfig
import com.airvpn.app.data.model.ConnectPayload
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object ConfigCrypto {
    private fun keyBytes(): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(BuildConfig.CONFIG_KEY_MATERIAL.toByteArray(StandardCharsets.UTF_8))
    }

    /** Returns plaintext config URI or null if expired/invalid. */
    fun decrypt(payload: ConnectPayload): String? {
        return try {
            val nonce = Base64.decode(payload.nonce, Base64.DEFAULT)
            val ct = Base64.decode(payload.ciphertext, Base64.DEFAULT)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes(), "AES"), GCMParameterSpec(128, nonce))
            val plain = String(cipher.doFinal(ct), StandardCharsets.UTF_8)
            val sep = plain.indexOf('|')
            if (sep <= 0) return null
            val expires = plain.substring(0, sep).toLongOrNull() ?: return null
            if (expires < System.currentTimeMillis() / 1000) return null
            plain.substring(sep + 1)
        } catch (_: Exception) {
            null
        }
    }
}
