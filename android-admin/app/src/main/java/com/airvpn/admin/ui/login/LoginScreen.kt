package com.airvpn.admin.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.airvpn.admin.BuildConfig
import com.airvpn.admin.ui.components.AdminButtonPadding
import com.airvpn.admin.ui.components.AdminButtonShape
import com.airvpn.admin.ui.components.AdminTextButton
import com.airvpn.admin.ui.components.adminPrimaryColors
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.OnPrimary
import com.airvpn.admin.ui.theme.Panel
import com.airvpn.admin.ui.theme.SurfaceBg

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
            .background(SurfaceBg)
            .navigationBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Panel)
                .statusBarsPadding()
                .padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "AirVPN Admin",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
            )
            Text(
                "Sign in with your Telegram ID and a one-time code from /admin_login.",
                style = MaterialTheme.typography.bodyMedium,
                color = InkMuted,
            )
        }
        HorizontalDivider(color = Hairline, thickness = 1.dp)

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            OutlinedTextField(
                value = telegramId,
                onValueChange = { telegramId = it.filter { c -> c.isDigit() } },
                label = { Text("Telegram user ID") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Navy,
                    cursorColor = Navy,
                ),
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.filter { c -> c.isDigit() }.take(6) },
                label = { Text("OTP code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Navy,
                    cursorColor = Navy,
                ),
            )
            if (!error.isNullOrBlank()) {
                Text(
                    error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {
                    val id = telegramId.toLongOrNull() ?: return@Button
                    onLogin(id, code)
                },
                enabled = !loading && telegramId.isNotBlank() && code.length >= 4,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                shape = AdminButtonShape,
                contentPadding = AdminButtonPadding,
                colors = adminPrimaryColors(),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = OnPrimary,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Sign in", fontWeight = FontWeight.SemiBold, color = OnPrimary)
                }
            }
            AdminTextButton(
                text = "Open Telegram bot",
                onClick = { uri.openUri(BuildConfig.TELEGRAM_BOT_URL) },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Text(
                "Admin access only. Sessions expire after 30 days.",
                style = MaterialTheme.typography.bodyMedium,
                color = InkMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
