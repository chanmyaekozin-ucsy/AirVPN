package com.airvpn.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.airvpn.app.ui.theme.Cyan
import com.airvpn.app.ui.theme.Ink
import kotlinx.coroutines.delay

private val ToastShape = RoundedCornerShape(14.dp)
private val ToastBg = Color(0xFFF0F7FC)

@Composable
fun AirToastHost(
    message: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    durationMs: Long = 2800L,
) {
    LaunchedEffect(message) {
        if (message.isNullOrBlank()) return@LaunchedEffect
        delay(durationMs)
        onDismiss()
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        AnimatedVisibility(
            visible = !message.isNullOrBlank(),
            enter = fadeIn() + slideInVertically { it / 2 },
            exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            Text(
                text = message.orEmpty(),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.Medium,
                ),
                color = Ink,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .shadow(8.dp, ToastShape, clip = false)
                    .background(ToastBg, ToastShape)
                    .border(1.dp, Cyan.copy(alpha = 0.35f), ToastShape)
                    .padding(horizontal = 18.dp, vertical = 14.dp)
                    .fillMaxWidth(),
            )
        }
    }
}
