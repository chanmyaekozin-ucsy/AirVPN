package com.airvpn.admin.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.airvpn.admin.BuildConfig
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy

@Composable
fun LoginScreen(
    loading: Boolean,
    error: String?,
    initialTelegramId: Long? = null,
    initialCode: String? = null,
    onLogin: (Long, String) -> Unit,
) {
    var telegramId by remember {
        mutableStateOf(initialTelegramId?.takeIf { it > 0 }?.toString().orEmpty())
    }
    var code by remember {
        mutableStateOf(initialCode.orEmpty().filter { it.isDigit() }.take(6))
    }
    val uri = LocalUriHandler.current

    LaunchedEffect(initialTelegramId, initialCode) {
        initialTelegramId?.takeIf { it > 0 }?.let { telegramId = it.toString() }
        initialCode?.filter { it.isDigit() }?.takeIf { it.isNotEmpty() }?.let {
            code = it.take(6)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "AirVPN Admin",
            style = MaterialTheme.typography.titleLarge,
            color = Navy,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Send /admin_login in Telegram, then tap Open AirVPN Admin.",
            style = MaterialTheme.typography.bodyMedium,
            color = InkMuted,
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = telegramId,
            onValueChange = { telegramId = it.filter { c -> c.isDigit() } },
            label = { Text("Telegram user ID") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.filter { c -> c.isDigit() }.take(6) },
            label = { Text("OTP code") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        if (!error.isNullOrBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                val id = telegramId.toLongOrNull() ?: return@Button
                onLogin(id, code)
            },
            enabled = !loading && telegramId.isNotBlank() && code.length >= 4,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (loading) CircularProgressIndicator(modifier = Modifier.height(18.dp))
            else Text("Sign in")
        }
        TextButton(onClick = { uri.openUri(BuildConfig.TELEGRAM_BOT_URL) }) {
            Text("Open Telegram bot")
        }
    }
}
