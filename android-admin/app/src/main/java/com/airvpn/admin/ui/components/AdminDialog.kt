package com.airvpn.admin.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Danger
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Ink
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Panel
import com.airvpn.admin.ui.theme.SurfaceBg
import com.airvpn.admin.ui.theme.Warning

val AdminDialogShape = RoundedCornerShape(18.dp)

@Composable
fun adminFieldColors(
    focused: Color = Navy,
    unfocused: Color = Hairline,
) = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = focused,
    unfocusedBorderColor = unfocused,
    disabledBorderColor = Hairline,
    focusedLabelColor = Navy,
    unfocusedLabelColor = InkMuted,
    cursorColor = Navy,
    focusedTextColor = Ink,
    unfocusedTextColor = Ink,
    disabledTextColor = InkMuted,
    focusedContainerColor = SurfaceBg,
    unfocusedContainerColor = SurfaceBg,
    disabledContainerColor = SurfaceBg,
)

@Composable
fun AdminDialog(
    onDismissRequest: () -> Unit,
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    subtitle: String? = null,
    confirmLabel: String? = null,
    onConfirm: (() -> Unit)? = null,
    confirmDestructive: Boolean = false,
    confirmColor: Color = if (confirmDestructive) Danger else Navy,
    dismissLabel: String = "Cancel",
    showDismiss: Boolean = true,
    scrollable: Boolean = true,
    maxContentHeight: Int = 480,
    properties: DialogProperties = DialogProperties(usePlatformDefaultWidth = false),
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = properties,
    ) {
        Column(
            modifier = modifier
                .fillMaxWidth(0.94f)
                .clip(AdminDialogShape)
                .background(Panel)
                .border(1.dp, Hairline, AdminDialogShape)
                .padding(20.dp),
        ) {
            Text(
                text = (eyebrow ?: "AirVPN Admin").uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = Cyan,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
            )
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = InkMuted,
                )
            }
            Spacer(Modifier.height(16.dp))
            QuietDivider()
            Spacer(Modifier.height(4.dp))

            val bodyModifier = if (scrollable) {
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = maxContentHeight.dp)
                    .verticalScroll(rememberScrollState())
            } else {
                Modifier.fillMaxWidth()
            }
            Column(
                modifier = bodyModifier,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )

            Spacer(Modifier.height(18.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (showDismiss) {
                    AdminTextButton(
                        text = dismissLabel,
                        onClick = onDismissRequest,
                        contentColor = InkMuted,
                    )
                }
                if (confirmLabel != null && onConfirm != null) {
                    AdminPrimaryButton(
                        text = confirmLabel,
                        onClick = onConfirm,
                        containerColor = confirmColor,
                        compact = true,
                    )
                }
            }
        }
    }
}

@Composable
fun AdminConfirmDialog(
    onDismissRequest: () -> Unit,
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    eyebrow: String = "Confirm",
    destructive: Boolean = false,
    dismissLabel: String = "Cancel",
) {
    AdminDialog(
        onDismissRequest = onDismissRequest,
        title = title,
        eyebrow = eyebrow,
        confirmLabel = confirmLabel,
        onConfirm = {
            onConfirm()
            onDismissRequest()
        },
        confirmDestructive = destructive,
        confirmColor = if (destructive) Danger else Warning,
        dismissLabel = dismissLabel,
        scrollable = false,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = InkMuted,
        )
    }
}
