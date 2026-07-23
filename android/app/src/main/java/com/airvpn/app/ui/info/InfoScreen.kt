package com.airvpn.app.ui.info

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvpn.app.data.model.SubscriptionInfo
import com.airvpn.app.data.model.UserProfile
import com.airvpn.app.ui.components.AirTextAction
import com.airvpn.app.ui.components.AirTopBar
import com.airvpn.app.ui.theme.Danger
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.InkMuted
import com.airvpn.app.ui.theme.Navy
import com.airvpn.app.ui.theme.SurfaceBg
import com.airvpn.app.ui.theme.contentColorFor
import com.airvpn.app.ui.theme.mutedContentColorFor
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun InfoScreen(
    profile: UserProfile?,
    activated: Boolean,
    subscriptions: List<SubscriptionInfo>,
    telegramUrl: String,
    privacyUrl: String,
    versionName: String,
    versionCode: Int,
    latestVersionName: String,
    updateAvailable: Boolean,
    deviceId: String,
    onCopyDeviceId: () -> Unit,
    onOpenUrl: (String) -> Unit,
    onCheckUpdate: () -> Unit,
    onClear: () -> Unit,
    onClearSubscription: () -> Unit,
    onRemoveSubscription: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        AirTopBar(title = "Info")

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            if (subscriptions.isNotEmpty()) {
                val importedSubs = subscriptions.filter { !it.isCatalogManaged }
                subscriptions.forEachIndexed { index, subscription ->
                    val title = when {
                        subscription.name.isNotBlank() -> subscription.name
                        subscription.isCatalogManaged -> "Free subscription"
                        subscriptions.size > 1 -> "Subscription ${index + 1}"
                        else -> "Subscription"
                    }
                    SettingsGroup(title = title) {
                        if (!subscription.isCatalogManaged) {
                            InfoLine(
                                "URL",
                                subscription.url.take(48) +
                                    if (subscription.url.length > 48) "…" else "",
                            )
                            HorizontalDivider(color = Hairline)
                        }
                        val usage = if (subscription.totalBytes > 0) {
                            "%.2f / %.2f GB".format(subscription.usedGb, subscription.totalGb)
                        } else {
                            "%.2f GB used".format(subscription.usedGb)
                        }
                        InfoLine("Data", usage)
                        if (subscription.totalBytes > 0) {
                            val frac = (subscription.usedBytes.toFloat() / subscription.totalBytes)
                                .coerceIn(0f, 1f)
                            LinearProgressIndicator(
                                progress = { frac },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 8.dp)
                                    .height(4.dp),
                                color = Navy,
                                trackColor = Hairline,
                            )
                        }
                        HorizontalDivider(color = Hairline)
                        val exp = if (subscription.expireAt > 0) {
                            SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
                                .format(Date(subscription.expireAt * 1000L))
                        } else {
                            "Unknown"
                        }
                        val days = subscription.daysLeft
                        val expValue = when {
                            subscription.expireAt <= 0 -> exp
                            subscription.isExpired -> {
                                val ago = days?.let { " · ${-it}d ago" }.orEmpty()
                                "Expired · $exp$ago"
                            }
                            days != null -> "$exp ($days days left)"
                            else -> exp
                        }
                        InfoLine("Expires", expValue)
                        HorizontalDivider(color = Hairline)
                        InfoLine("Nodes", "${subscription.nodeCount}")
                        if (!subscription.isCatalogManaged) {
                            HorizontalDivider(color = Hairline)
                            AirTextAction(
                                text = "Remove this subscription",
                                onClick = { onRemoveSubscription(subscription.url) },
                                color = Danger,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
                if (importedSubs.size > 1) {
                    SettingsGroup(title = "All subscriptions") {
                        AirTextAction(
                            text = "Remove all subscriptions",
                            onClick = onClearSubscription,
                            color = Danger,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        )
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }

            if (profile != null) {
                SettingsGroup(title = "Account") {
                    InfoLine(
                        "Data",
                        "%.2f / %.2f GB".format(profile.dataUsedGb, profile.dataLimitGb),
                    )
                    profile.expiresAt?.let {
                        HorizontalDivider(color = Hairline)
                        InfoLine("Expires", it)
                    }
                }
                Spacer(Modifier.height(16.dp))
            }

            SettingsGroup(title = "Support") {
                AirTextAction(
                    text = "Telegram contact",
                    onClick = { onOpenUrl(telegramUrl) },
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
                HorizontalDivider(color = Hairline, modifier = Modifier.padding(horizontal = 16.dp))
                AirTextAction(
                    text = "Privacy Policy",
                    onClick = { onOpenUrl(privacyUrl) },
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }

            Spacer(Modifier.height(16.dp))

            SettingsGroup(title = "App") {
                InfoLine("Version", "$versionName ($versionCode)")
                if (deviceId.isNotBlank()) {
                    HorizontalDivider(color = Hairline)
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onCopyDeviceId)
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                    ) {
                        Text(
                            "Device ID",
                            style = MaterialTheme.typography.labelSmall,
                            color = InkMuted,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            deviceId,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Navy,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Tap to copy",
                            style = MaterialTheme.typography.labelSmall,
                            color = InkMuted,
                        )
                    }
                }
                if (latestVersionName.isNotBlank() && updateAvailable) {
                    HorizontalDivider(color = Hairline)
                    InfoLine("Latest", latestVersionName)
                    AirTextAction(
                        text = "Update available — tap to install",
                        onClick = onCheckUpdate,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
                if (activated) {
                    HorizontalDivider(color = Hairline)
                    AirTextAction(
                        text = "Clear restore code",
                        onClick = onClear,
                        color = Danger,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun SettingsGroup(
    title: String,
    content: @Composable () -> Unit,
) {
    val cardBg = Color.White
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.8.sp,
        ),
        color = mutedContentColorFor(SurfaceBg),
        modifier = Modifier.padding(start = 4.dp, bottom = 8.dp),
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(cardBg),
    ) {
        content()
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    val cardBg = Color.White
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = mutedContentColorFor(cardBg),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = contentColorFor(cardBg),
        )
    }
}
