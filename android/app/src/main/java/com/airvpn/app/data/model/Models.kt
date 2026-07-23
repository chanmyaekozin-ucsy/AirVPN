package com.airvpn.app.data.model

data class AppConfig(
    val minVersionCode: Int = 1,
    val latestVersionCode: Int = 1,
    val latestVersionName: String = "",
    val forceUpdate: Boolean = false,
    val changelog: String = "",
    val telegramUrl: String = "",
    val playUrl: String = "",
    val updateUrl: String = "",
    val buyUrl: String = "",
    val privacyUrl: String = "",
    val maintenance: Boolean = false,
    val maintenanceMessage: String = "",
    val announcements: List<Announcement> = emptyList(),
    val ads: List<AdCreative> = emptyList(),
)

data class Announcement(
    val id: String,
    val title: String,
    val body: String,
    val level: String = "info",
    val dismissible: Boolean = true,
    val ctaLabel: String = "",
    val ctaUrl: String = "",
)

/** First-party ad from AirVPN API / admin bot (not AdMob). */
data class AdCreative(
    val id: String,
    val placement: String, // banner | dialog
    val title: String = "",
    val imageUrl: String = "",
    val clickUrl: String = "",
    val width: Int = 0,
    val height: Int = 0,
) {
    val isBanner: Boolean get() = placement.equals("banner", ignoreCase = true)
    val isDialog: Boolean get() = placement.equals("dialog", ignoreCase = true)
    val aspectRatio: Float
        get() = if (width > 0 && height > 0) width.toFloat() / height.toFloat() else 0f
}

data class ServerPlan(
    val title: String? = null,
    val priceKs: Int? = null,
    val dataGb: Double? = null,
    val durationDays: Int? = null,
) {
    val priceLabel: String
        get() = priceKs?.let { "%,d Ks".format(it) } ?: ""

    val summary: String
        get() = buildString {
            title?.takeIf { it.isNotBlank() }?.let { append(it) }
            if (priceKs != null) {
                if (isNotEmpty()) append(" · ")
                append("%,d Ks".format(priceKs))
            }
        }
}

data class VpnServerItem(
    val id: String,
    val name: String,
    val region: String = "",
    val protocol: String = "vless",
    val tag: String = "Vless",
    val tier: String = "free",
    val plan: ServerPlan? = null,
    val plans: List<ServerPlan> = emptyList(),
    val buyUrl: String? = null,
    /** False when the API probe cannot reach the node. */
    val online: Boolean = true,
    /**
     * Local share link (vless:// / ss://) for imported keys.
     * When set, connect skips the mobile API and uses this URI directly.
     */
    val configUri: String? = null,
    /** Host / IP for display + ping. */
    val host: String? = null,
    /** TCP port for ping (0 = unknown / use URI). */
    val port: Int = 0,
    /** True when the node came from a subscription URL refresh. */
    val fromSubscription: Boolean = false,
    /** Which subscription URL produced this node (null for manual imports). */
    val subscriptionUrl: String? = null,
) {
    val isImported: Boolean get() = !configUri.isNullOrBlank() || id.startsWith("import-")
    val isPaid: Boolean get() = tier.equals("paid", ignoreCase = true)
    val allPlans: List<ServerPlan>
        get() = when {
            plans.isNotEmpty() -> plans
            plan != null -> listOf(plan)
            else -> emptyList()
        }
}

data class ServerCatalog(
    val free: List<VpnServerItem> = emptyList(),
    val paid: List<VpnServerItem> = emptyList(),
    /** Free catalog http(s) subscription parents (usage from API). */
    val freeSubscriptions: List<SubscriptionInfo> = emptyList(),
)

data class UserProfile(
    val userId: Int = 0,
    val hasPaid: Boolean = false,
    val dataUsedGb: Double = 0.0,
    val dataLimitGb: Double = 0.0,
    val expiresAt: String? = null,
)

/** Parsed from subscription HTTP response (subscription-userinfo). */
data class SubscriptionInfo(
    val url: String = "",
    /** Optional display title (catalog free sub name). */
    val name: String = "",
    val uploadBytes: Long = 0,
    val downloadBytes: Long = 0,
    val totalBytes: Long = 0,
    /** Unix seconds; 0 if unknown. */
    val expireAt: Long = 0,
    val nodeCount: Int = 0,
    val lastFetchedAt: Long = 0,
) {
    /** True when this sub is managed by the free server catalog (not user-imported). */
    val isCatalogManaged: Boolean get() = url.startsWith("catalog://", ignoreCase = true)
    val usedBytes: Long get() = (uploadBytes + downloadBytes).coerceAtLeast(0)
    val usedGb: Double get() = usedBytes / (1024.0 * 1024.0 * 1024.0)
    val totalGb: Double get() = if (totalBytes > 0) totalBytes / (1024.0 * 1024.0 * 1024.0) else 0.0
    val remainingGb: Double
        get() = if (totalBytes > 0) ((totalBytes - usedBytes).coerceAtLeast(0)) / (1024.0 * 1024.0 * 1024.0) else 0.0
    val isExpired: Boolean
        get() = expireAt > 0 && expireAt < System.currentTimeMillis() / 1000
    /** Shared free pool exhausted (used >= total). */
    val isExhausted: Boolean
        get() = totalBytes > 0 && usedBytes >= totalBytes

    /** Whole days until expiry (0 if expires today); null if unknown; negative if expired. */
    val daysLeft: Long?
        get() {
            if (expireAt <= 0) return null
            val nowSec = System.currentTimeMillis() / 1000
            val diff = expireAt - nowSec
            return if (diff >= 0) (diff + 86_399) / 86_400 else diff / 86_400
        }
}

data class ConnectPayload(
    val alg: String,
    val nonce: String,
    val ciphertext: String,
    val expiresAt: Long,
)

data class ConnectResponse(
    val serverId: String,
    val protocol: String,
    val payload: ConnectPayload,
)
