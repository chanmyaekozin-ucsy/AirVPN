package com.airvpn.admin.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.OnPrimary
import com.airvpn.admin.ui.theme.Panel
import com.airvpn.admin.ui.theme.Success
import com.airvpn.admin.ui.theme.SurfaceBg
import com.airvpn.admin.ui.theme.Warning

val AdminButtonShape = RoundedCornerShape(10.dp)
val AdminButtonPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp)
val AdminCompactButtonPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)

@Composable
fun adminPrimaryColors(container: Color = Navy) = ButtonDefaults.buttonColors(
    containerColor = container,
    contentColor = OnPrimary,
    disabledContainerColor = container.copy(alpha = 0.38f),
    disabledContentColor = OnPrimary.copy(alpha = 0.7f),
)

@Composable
fun adminOutlinedColors(content: Color = Navy) = ButtonDefaults.outlinedButtonColors(
    contentColor = content,
    disabledContentColor = content.copy(alpha = 0.4f),
)

@Composable
fun AdminPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: Color = Navy,
    compact: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = AdminButtonShape,
        contentPadding = if (compact) AdminCompactButtonPadding else AdminButtonPadding,
        colors = adminPrimaryColors(containerColor),
    ) {
        Text(text, fontWeight = FontWeight.SemiBold, color = OnPrimary)
    }
}

@Composable
fun AdminOutlinedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    contentColor: Color = Navy,
    compact: Boolean = false,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = AdminButtonShape,
        contentPadding = if (compact) AdminCompactButtonPadding else AdminButtonPadding,
        colors = adminOutlinedColors(contentColor),
    ) {
        Text(text, fontWeight = FontWeight.Medium, color = contentColor)
    }
}

@Composable
fun AdminTextButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentColor: Color = Navy,
) {
    TextButton(
        onClick = onClick,
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        colors = ButtonDefaults.textButtonColors(contentColor = contentColor),
    ) {
        Text(text, fontWeight = FontWeight.Medium, color = contentColor)
    }
}

@Composable
fun AdminScreen(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(SurfaceBg)
            .padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = (eyebrow ?: title).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = Cyan,
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = Ink,
                    fontWeight = FontWeight.SemiBold,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = InkMuted)
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
        Spacer(Modifier.height(16.dp))
        content()
    }
}

@Composable
fun AdminPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Panel)
            .border(1.dp, Hairline, RoundedCornerShape(16.dp))
            .padding(16.dp),
        content = content,
    )
}

@Composable
fun MetricTile(
    label: String,
    value: String,
    accent: Color = Cyan,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Panel)
            .border(1.dp, Hairline, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(accent),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = InkMuted,
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = Ink,
        )
    }
}

enum class StatusTone { Success, Danger, Warning, Info, Neutral }

@Composable
fun StatusChip(
    text: String,
    tone: StatusTone = StatusTone.Neutral,
) {
    val (bg, fg) = when (tone) {
        StatusTone.Success -> Success.copy(alpha = 0.12f) to Success
        StatusTone.Danger -> Danger.copy(alpha = 0.12f) to Danger
        StatusTone.Warning -> Warning.copy(alpha = 0.14f) to Warning
        StatusTone.Info -> Cyan.copy(alpha = 0.14f) to Navy
        StatusTone.Neutral -> Hairline to InkMuted
    }
    Text(
        text = text.uppercase(),
        color = fg,
        fontWeight = FontWeight.SemiBold,
        fontSize = 10.sp,
        letterSpacing = 0.8.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

@Composable
fun AdminTopChrome(
    title: String,
    subtitle: String,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    refreshIcon: ImageVector,
    logoutIcon: ImageVector,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Panel)
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp, top = 10.dp, bottom = 10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = InkMuted,
                    )
                }
            }
            IconButton(onClick = onRefresh) {
                Icon(refreshIcon, contentDescription = "Refresh", tint = InkMuted)
            }
            IconButton(onClick = onLogout) {
                Icon(logoutIcon, contentDescription = "Logout", tint = InkMuted)
            }
        }
        HorizontalDivider(color = Hairline, thickness = 1.dp)
    }
}

@Composable
fun ListRowCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Panel)
            .border(1.dp, Hairline, RoundedCornerShape(14.dp))
            .padding(16.dp),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = InkMuted,
        modifier = Modifier.padding(bottom = 8.dp),
    )
}

@Composable
fun QuietDivider() {
    HorizontalDivider(color = Hairline, thickness = 1.dp, modifier = Modifier.padding(vertical = 10.dp))
}
