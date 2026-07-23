package com.airvpn.admin.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.OnPrimary
import com.airvpn.admin.ui.theme.Panel
import com.airvpn.admin.ui.theme.SurfaceBg
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

data class AdminNavItem(
    val key: String,
    val label: String,
    val icon: ImageVector,
)

private data class NavBounds(val left: Float, val width: Float)

private val DockShape = RoundedCornerShape(26.dp)
private val PillShape = RoundedCornerShape(20.dp)

/** Soft ease-out — no overshoot, settles like air. */
private val AirEase = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

/** Critically damped + soft — glides without engine bounce. */
private fun airSpring() = spring<Float>(
    dampingRatio = 1f,
    stiffness = 280f,
)

@Composable
fun AdminBottomNav(
    items: List<AdminNavItem>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scroll = rememberScrollState()
    val bounds = remember { mutableStateMapOf<String, NavBounds>() }
    val indicatorX = remember { Animatable(0f) }
    val indicatorW = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    fun moveIndicator(key: String, animate: Boolean) {
        val b = bounds[key] ?: return
        scope.launch {
            if (!animate || indicatorW.value < 2f) {
                indicatorX.snapTo(b.left)
                indicatorW.snapTo(b.width)
                return@launch
            }
            launch { indicatorX.animateTo(b.left, airSpring()) }
            launch { indicatorW.animateTo(b.width, airSpring()) }
        }
    }

    LaunchedEffect(selectedKey) {
        moveIndicator(selectedKey, animate = true)
        val b = bounds[selectedKey] ?: return@LaunchedEffect
        val viewport = scroll.viewportSize.toFloat().coerceAtLeast(1f)
        val target = (b.left + b.width / 2f - viewport / 2f)
            .coerceIn(0f, scroll.maxValue.toFloat())
            .roundToInt()
        if (kotlin.math.abs(scroll.value - target) > 4) {
            scroll.animateScrollTo(
                target,
                animationSpec = tween(520, easing = AirEase),
            )
        }
    }

    // When layout settles (first measure / rotation), keep bubble aligned without jumping mid-gesture.
    LaunchedEffect(bounds[selectedKey]?.left, bounds[selectedKey]?.width) {
        val b = bounds[selectedKey] ?: return@LaunchedEffect
        val dx = kotlin.math.abs(indicatorX.value - b.left)
        val dw = kotlin.math.abs(indicatorW.value - b.width)
        if (indicatorW.value < 2f) {
            moveIndicator(selectedKey, animate = false)
        } else if (dx > 1.5f || dw > 1.5f) {
            moveIndicator(selectedKey, animate = true)
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        SurfaceBg.copy(alpha = 0f),
                        SurfaceBg.copy(alpha = 0.88f),
                        SurfaceBg,
                    ),
                ),
            )
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 12.dp,
                    shape = DockShape,
                    ambientColor = Navy.copy(alpha = 0.12f),
                    spotColor = Navy.copy(alpha = 0.14f),
                )
                .clip(DockShape)
                .background(Panel)
                .border(1.dp, Hairline, DockShape)
                .padding(horizontal = 5.dp, vertical = 5.dp),
        ) {
            Box(
                modifier = Modifier
                    .height(54.dp)
                    .horizontalScroll(scroll)
                    .fillMaxWidth(),
            ) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .offset { IntOffset(indicatorX.value.roundToInt(), 0) }
                        .width(with(density) { indicatorW.value.toDp().coerceAtLeast(1.dp) })
                        .fillMaxHeight()
                        .graphicsLayer { alpha = if (indicatorW.value > 2f) 1f else 0f }
                        .clip(PillShape)
                        .background(
                            Brush.linearGradient(
                                colors = listOf(
                                    Navy,
                                    Color(0xFF1E6BB8),
                                    Cyan.copy(alpha = 0.9f),
                                ),
                            ),
                        ),
                )

                Row(
                    modifier = Modifier
                        .height(54.dp)
                        .padding(horizontal = 1.dp),
                    horizontalArrangement = Arrangement.spacedBy(0.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    items.forEach { item ->
                        AdminNavPill(
                            item = item,
                            selected = item.key == selectedKey,
                            onClick = { onSelect(item.key) },
                            modifier = Modifier.onGloballyPositioned { coords ->
                                val left = coords.positionInParent().x
                                val width = coords.size.width.toFloat()
                                val prev = bounds[item.key]
                                if (prev == null ||
                                    kotlin.math.abs(prev.left - left) > 0.5f ||
                                    kotlin.math.abs(prev.width - width) > 0.5f
                                ) {
                                    bounds[item.key] = NavBounds(left, width)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminNavPill(
    item: AdminNavItem,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    // Tiny, critically damped lift — no bouncy "engine" feel.
    val lift by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = tween(380, easing = AirEase),
        label = "navLift",
    )
    val iconTint by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = tween(320, easing = AirEase),
        label = "navTint",
    )

    Column(
        modifier = modifier
            .clip(PillShape)
            .clickable(
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .width(52.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(26.dp)
                .graphicsLayer {
                    val s = 1f + 0.04f * lift
                    scaleX = s
                    scaleY = s
                    translationY = -1.2f * lift
                }
                .clip(CircleShape)
                .background(lerp(Hairline.copy(alpha = 0.45f), OnPrimary.copy(alpha = 0.18f), iconTint)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = item.icon,
                contentDescription = item.label,
                tint = lerp(InkMuted, OnPrimary, iconTint),
                modifier = Modifier.size(15.dp),
            )
        }
        Spacer(Modifier.height(3.dp))
        Text(
            text = item.label,
            color = lerp(InkMuted, OnPrimary, iconTint),
            fontWeight = FontWeight.Medium,
            fontSize = 9.sp,
            letterSpacing = 0.1.sp,
            maxLines = 1,
            overflow = TextOverflow.Clip,
            modifier = Modifier.graphicsLayer { alpha = 0.55f + 0.45f * iconTint },
        )
    }
}
