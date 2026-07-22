package com.airvpn.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.airvpn.app.data.model.AdCreative
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.Ink
import com.airvpn.app.ui.theme.InkMuted
import com.airvpn.app.ui.theme.Navy
import kotlinx.coroutines.delay

/**
 * Horizontal first-party banner (admin-managed image).
 * Aspect follows [AdCreative.width]/[AdCreative.height] when provided.
 */
@Composable
fun AdBanner(
    ad: AdCreative,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(10.dp)
    val ratio = when {
        ad.aspectRatio > 0f -> ad.aspectRatio.coerceIn(2f, 10f)
        else -> 6.4f // typical 320x50
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, Hairline, shape)
            .background(androidx.compose.ui.graphics.Color.White)
            .clickable(enabled = ad.clickUrl.isNotBlank(), onClick = onClick),
    ) {
        AsyncImage(
            model = ad.imageUrl,
            contentDescription = ad.title.ifBlank { "Ad" },
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(ratio),
        )
    }
}

/**
 * Connect interstitial: shows ad image sized by its aspect ratio, mandatory ~3s wait.
 */
@Composable
fun ConnectAdDialog(
    ad: AdCreative,
    onFinished: () -> Unit,
    onClickAd: () -> Unit,
    seconds: Int = 3,
) {
    var remaining by remember(ad.id) { mutableIntStateOf(seconds) }

    LaunchedEffect(ad.id) {
        remaining = seconds
        while (remaining > 0) {
            delay(1_000)
            remaining -= 1
        }
        onFinished()
    }

    val ratio = when {
        ad.aspectRatio > 0f -> ad.aspectRatio
        else -> 0.75f // portrait-ish default for dialog creatives
    }

    Dialog(
        onDismissRequest = { /* must wait */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 24.dp)
                .widthIn(max = 360.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(androidx.compose.ui.graphics.Color.White)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (ad.title.isNotBlank()) {
                Text(
                    text = ad.title,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = Ink,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
            }
            SubcomposeAsyncImage(
                model = ad.imageUrl,
                contentDescription = ad.title.ifBlank { "Ad" },
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(ratio)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(enabled = ad.clickUrl.isNotBlank(), onClick = onClickAd),
                loading = {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .aspectRatio(ratio),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = Navy, strokeWidth = 2.dp)
                    }
                },
            )
            Spacer(Modifier.height(14.dp))
            Text(
                text = if (remaining > 0) {
                    "Connecting in ${remaining}s…"
                } else {
                    "Connecting…"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = InkMuted,
            )
        }
    }
}
