package com.airvpn.admin.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.airvpn.admin.BuildConfig
import com.airvpn.admin.ui.theme.AccentWash
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.NightGradient
import com.airvpn.admin.ui.theme.OnNight
import com.airvpn.admin.ui.theme.OnNightMuted
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
            .background(SurfaceBg),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(NightGradient)
                .padding(horizontal = 24.dp, vertical = 36.dp),
        ) {
            Column {
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(AccentWash),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "A",
                        color = OnNight,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleLarge,
                    )
                }
                Spacer(Modifier.height(18.dp))
                Text("CONTROL", style = MaterialTheme.typography.labelSmall, color = Cyan)
                Text(
                    "AirVPN Admin",
                    style = MaterialTheme.typography.displaySmall,
                    color = OnNight,
                    fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Secure console for payments, plans, users, and ads.",
                    color = OnNightMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Panel)
                    .border(1.dp, Hairline, RoundedCornerShape(18.dp))
                    .padding(18.dp),
            ) {
                Text("Operator sign-in", fontWeight = FontWeight.SemiBold, color = Ink)
                Text(
                    "Run /admin_login in Telegram, then open the deep link — or enter OTP here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
                )
                OutlinedTextField(
                    value = telegramId,
                    onValueChange = { telegramId = it.filter { c -> c.isDigit() } },
                    label = { Text("Telegram user ID") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Navy,
                        cursorColor = Navy,
                    ),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it.filter { c -> c.isDigit() }.take(6) },
                    label = { Text("One-time code") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Navy,
                        cursorColor = Navy,
                    ),
                )
                if (!error.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        val id = telegramId.toLongOrNull() ?: return@Button
                        onLogin(id, code)
                    },
                    enabled = !loading && telegramId.isNotBlank() && code.length >= 4,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Navy),
                ) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = OnNight,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Enter console", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            TextButton(
                onClick = { uri.openUri(BuildConfig.TELEGRAM_BOT_URL) },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text("Open Telegram bot", color = Navy)
            }
            Text(
                "Authorized operators only · session lasts 30 days",
                style = MaterialTheme.typography.labelSmall,
                color = InkMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
