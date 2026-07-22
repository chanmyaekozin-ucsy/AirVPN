package com.airvpn.app.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.airvpn.app.R
import com.airvpn.app.ui.theme.Cyan
import com.airvpn.app.ui.theme.Hairline
import com.airvpn.app.ui.theme.Navy
import com.airvpn.app.ui.theme.accentContentColor
import com.airvpn.app.ui.theme.softSurface
import com.airvpn.app.vpn.VpnState
import kotlin.math.min

@Composable
fun AirLogoMark(
    state: VpnState,
    modifier: Modifier = Modifier,
    logoSize: Dp = 148.dp,
) {
    val connecting = state == VpnState.Connecting
    val connected = state == VpnState.Connected
    val infinite = rememberInfiniteTransition(label = "logo")

    val pulse by infinite.animateFloat(
        initialValue = 1f,
        targetValue = if (connecting) 1.035f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )
    val sweep by infinite.animateFloat(
        initialValue = 0f,
        targetValue = if (connecting) 360f else 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "sweep",
    )
    // Flow phase along the cyan wave (bottom-left → top-right)
    val waveFlow by infinite.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "waveFlow",
    )
    val waveSheen by infinite.animateFloat(
        initialValue = 0.55f,
        targetValue = if (connected) 1f else 0.55f,
        animationSpec = infiniteRepeatable(
            animation = tween(1400, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "waveSheen",
    )
    val ringProgress by animateFloatAsState(
        targetValue = when {
            connected -> 1f
            connecting -> 0.72f
            else -> 0f
        },
        animationSpec = tween(500, easing = FastOutSlowInEasing),
        label = "ring",
    )
    val markScaleTarget by animateFloatAsState(
        targetValue = if (connected) 1.02f else 1f,
        animationSpec = tween(400),
        label = "logoScale",
    )

    Box(modifier = modifier.size(logoSize), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 2.5.dp.toPx()
            val pad = stroke / 2 + 2.dp.toPx()
            val diam = min(this.size.width, this.size.height) - pad * 2
            val topLeft = Offset(pad, pad)
            val arcSize = Size(diam, diam)

            drawArc(
                color = Hairline,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = 1.dp.toPx(), cap = StrokeCap.Round),
            )

            if (ringProgress > 0f) {
                val color = if (connected) Cyan else Navy
                if (connecting) {
                    drawArc(
                        color = color.copy(alpha = 0.9f),
                        startAngle = -90f + sweep,
                        sweepAngle = 110f,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                } else {
                    drawArc(
                        color = color,
                        startAngle = -90f,
                        sweepAngle = 360f * ringProgress,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
            }
        }

        val markScale = if (connecting) pulse else markScaleTarget
        Box(
            modifier = Modifier
                .size(logoSize * 0.62f)
                .scale(markScale)
                .alpha(if (connecting) 0.92f else 1f),
            contentAlignment = Alignment.Center,
        ) {
            // Navy "A" — static base, fully transparent outside the glyph
            Image(
                painter = painterResource(R.drawable.logo_airvpn_a),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )

            // Cyan air wave — flowing highlight when protected
            Image(
                painter = painterResource(R.drawable.logo_airvpn_wave),
                contentDescription = "AirVPN",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        // Offscreen layer required for SrcAtop sheen on the wave alpha
                        compositingStrategy = CompositingStrategy.Offscreen
                        if (connected) {
                            // Tiny drift along the wave diagonal (air flow feel)
                            translationX = (waveFlow - 0.5f) * 2.5f
                            translationY = (0.5f - waveFlow) * 1.5f
                        }
                    }
                    .drawWithContent {
                        drawContent()
                        if (connected) {
                            val w = this.size.width
                            val h = this.size.height
                            // Sweep a bright band along the wave diagonal
                            val t = waveFlow
                            val start = Offset(
                                x = -w * 0.35f + w * 1.7f * t,
                                y = h * 1.15f - h * 1.7f * t,
                            )
                            val end = Offset(
                                x = start.x + w * 0.55f,
                                y = start.y - h * 0.55f,
                            )
                            drawRect(
                                brush = Brush.linearGradient(
                                    colorStops = arrayOf(
                                        0.00f to Color.Transparent,
                                        0.35f to Cyan.copy(alpha = 0.15f * waveSheen),
                                        0.48f to Color.White.copy(alpha = 0.75f * waveSheen),
                                        0.58f to Cyan.copy(alpha = 0.55f * waveSheen),
                                        0.72f to Color.Transparent,
                                        1.00f to Color.Transparent,
                                    ),
                                    start = start,
                                    end = end,
                                ),
                                blendMode = BlendMode.SrcAtop,
                            )
                        }
                    },
            )
        }
    }
}

@Composable
fun ProtocolTag(tag: String, modifier: Modifier = Modifier) {
    val bg = softSurface(Cyan, alpha = 0.14f)
    val fg = accentContentColor(Cyan)
    Text(
        text = tag,
        style = MaterialTheme.typography.labelSmall,
        color = fg,
        modifier = modifier
            .background(bg, RoundedCornerShape(4.dp))
            .border(1.dp, Cyan.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
