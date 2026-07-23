package com.airvpn.admin.ui.appconfig

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.airvpn.admin.data.model.AppConfigSettings
import com.airvpn.admin.ui.components.AdminPrimaryButton
import com.airvpn.admin.ui.components.AdminScreen
import com.airvpn.admin.ui.components.adminFieldColors
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy

@Composable
fun AppConfigScreen(
    config: AppConfigSettings?,
    saving: Boolean,
    onSave: (AppConfigSettings) -> Unit,
    modifier: Modifier = Modifier,
) {
    var minCode by remember { mutableStateOf("1") }
    var latestCode by remember { mutableStateOf("1") }
    var latestName by remember { mutableStateOf("1.0.0") }
    var forceUpdate by remember { mutableStateOf(false) }
    var changelog by remember { mutableStateOf("") }
    var maintenance by remember { mutableStateOf(false) }
    var maintenanceMessage by remember { mutableStateOf("") }
    var telegramUrl by remember { mutableStateOf("") }
    var playUrl by remember { mutableStateOf("") }
    var updateUrl by remember { mutableStateOf("") }
    var buyUrl by remember { mutableStateOf("") }
    var privacyUrl by remember { mutableStateOf("") }

    LaunchedEffect(config) {
        val c = config ?: return@LaunchedEffect
        minCode = c.minVersionCode.toString()
        latestCode = c.latestVersionCode.toString()
        latestName = c.latestVersionName
        forceUpdate = c.forceUpdate
        changelog = c.changelog
        maintenance = c.maintenance
        maintenanceMessage = c.maintenanceMessage
        telegramUrl = c.telegramUrl
        playUrl = c.playUrl
        updateUrl = c.updateUrl
        buyUrl = c.buyUrl
        privacyUrl = c.privacyUrl
    }

    AdminScreen(
        title = "App config",
        subtitle = "Updates, maintenance, download links",
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionTitle("Version control")
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = minCode,
                    onValueChange = { minCode = it.filter { ch -> ch.isDigit() }.take(6) },
                    label = { Text("Min version code") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    colors = adminFieldColors(),
                )
                OutlinedTextField(
                    value = latestCode,
                    onValueChange = { latestCode = it.filter { ch -> ch.isDigit() }.take(6) },
                    label = { Text("Latest version code") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    colors = adminFieldColors(),
                )
            }
            OutlinedTextField(
                value = latestName,
                onValueChange = { latestName = it.take(32) },
                label = { Text("Latest version name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )
            ToggleRow(
                title = "Force update",
                subtitle = "Block app until users update (also when below min code)",
                checked = forceUpdate,
                onCheckedChange = { forceUpdate = it },
            )
            OutlinedTextField(
                value = changelog,
                onValueChange = { changelog = it.take(4000) },
                label = { Text("Changelog") },
                modifier = Modifier.fillMaxWidth().height(120.dp),
                colors = adminFieldColors(),
            )

            SectionTitle("Maintenance")
            ToggleRow(
                title = "Maintenance mode",
                subtitle = "Blocks connect on all client apps",
                checked = maintenance,
                onCheckedChange = { maintenance = it },
            )
            OutlinedTextField(
                value = maintenanceMessage,
                onValueChange = { maintenanceMessage = it.take(1000) },
                label = { Text("Maintenance message") },
                modifier = Modifier.fillMaxWidth().height(100.dp),
                colors = adminFieldColors(),
            )

            SectionTitle("Download & links")
            OutlinedTextField(
                value = updateUrl,
                onValueChange = { updateUrl = it.take(512) },
                label = { Text("Update / APK download URL (Telegram)") },
                supportingText = { Text("Opened when user taps Update — prefer TG channel/file") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                value = telegramUrl,
                onValueChange = { telegramUrl = it.take(512) },
                label = { Text("Telegram bot / channel URL") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                value = playUrl,
                onValueChange = { playUrl = it.take(512) },
                label = { Text("Play Store URL (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                value = buyUrl,
                onValueChange = { buyUrl = it.take(512) },
                label = { Text("Buy / bot deep link") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )
            OutlinedTextField(
                value = privacyUrl,
                onValueChange = { privacyUrl = it.take(512) },
                label = { Text("Privacy policy URL") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = adminFieldColors(),
            )

            Spacer(Modifier.height(8.dp))
            AdminPrimaryButton(
                text = if (saving) "Saving…" else "Save app config",
                onClick = {
                    onSave(
                        AppConfigSettings(
                            minVersionCode = minCode.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                            latestVersionCode = latestCode.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                            latestVersionName = latestName.ifBlank { "1.0.0" },
                            forceUpdate = forceUpdate,
                            changelog = changelog,
                            maintenance = maintenance,
                            maintenanceMessage = maintenanceMessage,
                            telegramUrl = telegramUrl.trim(),
                            playUrl = playUrl.trim(),
                            updateUrl = updateUrl.trim(),
                            buyUrl = buyUrl.trim(),
                            privacyUrl = privacyUrl.trim(),
                        ),
                    )
                },
                enabled = !saving && config != null,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "Clients read this on launch via /v1/app/config. Min code forces update; " +
                    "force update + newer latest code also forces.",
                style = MaterialTheme.typography.bodySmall,
                color = InkMuted,
                modifier = Modifier.padding(bottom = 24.dp),
            )
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
        color = Navy,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun ToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = InkMuted)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Navy,
                checkedThumbColor = Cyan,
            ),
        )
    }
}
