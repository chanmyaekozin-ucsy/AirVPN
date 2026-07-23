package com.airvpn.admin.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Panel

@Composable
private fun shimmerBrush(): Brush {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val x by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(
            animation = tween(1100, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmerX",
    )
    val base = Hairline.copy(alpha = 0.55f)
    val highlight = Color.White.copy(alpha = 0.85f)
    return Brush.linearGradient(
        colors = listOf(base, highlight, base),
        start = Offset(x - 200f, 0f),
        end = Offset(x + 200f, 180f),
    )
}

@Composable
fun ShimmerBlock(
    modifier: Modifier = Modifier,
    height: Dp = 14.dp,
) {
    Box(
        modifier = modifier
            .height(height)
            .clip(RoundedCornerShape(8.dp))
            .background(shimmerBrush()),
    )
}

@Composable
fun ShimmerCard(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Panel)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        ShimmerBlock(modifier = Modifier.fillMaxWidth(0.55f), height = 16.dp)
        ShimmerBlock(modifier = Modifier.fillMaxWidth(0.85f), height = 12.dp)
        ShimmerBlock(modifier = Modifier.fillMaxWidth(0.4f), height = 12.dp)
        ShimmerBlock(modifier = Modifier.fillMaxWidth(), height = 36.dp)
    }
}

@Composable
fun ShimmerList(count: Int = 4, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(count) {
            ShimmerCard()
        }
    }
}

@Composable
fun LoadingTopBar(visible: Boolean) {
    if (visible) {
        LinearProgressIndicator(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp),
            color = Cyan,
            trackColor = Navy.copy(alpha = 0.08f),
        )
    }
}
