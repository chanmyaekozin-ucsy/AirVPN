package com.airvpn.admin.data.model

data class AdminStats(
    val users: Int = 0,
    val banned: Int = 0,
    val activeUsers: Int = 0,
    val activeKeys: Int = 0,
    val paidKeys: Int = 0,
    val freeKeys: Int = 0,
    val pending: Int = 0,
    val approved: Int = 0,
    val rejected: Int = 0,
    val revenueKs: Int = 0,
    val usedGb: Double = 0.0,
    val limitGb: Double = 0.0,
    val keysByServer: String = "",
    val dauToday: Int = 0,
    val dau7d: Int = 0,
    val adClicksToday: Int = 0,
    val adClicksTotal: Int = 0,
)

data class PaymentItem(
    val id: Int,
    val status: String,
    val method: String,
    val amountKs: Int,
    val serverId: String,
    val planTitle: String?,
    val telegramId: Long,
    val username: String?,
    val firstName: String?,
    val rejectReason: String?,
    val createdAt: String?,
    val receiptTxId: String? = null,
    val receiptNote: String? = null,
    val hasReceipt: Boolean = false,
    val receiptUrl: String? = null,
    val dataGb: Double? = null,
    val durationDays: Int? = null,
    val subDataLimitGb: Double? = null,
    val subDataUsedGb: Double? = null,
    val subDataLeftGb: Double? = null,
    val subExpiresAt: String? = null,
    val subDaysLeft: Int? = null,
    val subIsActive: Boolean? = null,
)

data class PaymentAccount(
    val id: Int,
    val method: String,
    val accountNumber: String,
    val accountName: String,
    val isActive: Boolean,
)

data class VpnServerInfo(
    val id: String,
    val nameEn: String,
    val nameMy: String,
    val vpsHost: String,
    val vpsPort: Int,
    val panelConfigured: Boolean,
    val planCount: Int,
)

data class PlanItem(
    val id: Int,
    val title: String,
    val dataGb: Double,
    val priceKs: Int,
    val durationDays: Int,
    val serverId: String,
    val sortOrder: Int,
    val isActive: Boolean,
)

data class UserItem(
    val telegramId: Long,
    val username: String?,
    val firstName: String?,
    val isBanned: Boolean,
    val freeKeys: Int,
    val paidKeys: Int,
)

data class CatalogServer(
    val id: String,
    val name: String,
    val region: String,
    val protocol: String,
    val tier: String,
    val enabled: Boolean,
    val sortOrder: Int,
    val configUri: String?,
)

data class AdItem(
    val id: String,
    val placement: String,
    val title: String,
    val imageUrl: String,
    val clickUrl: String,
    val imageWidth: Int,
    val imageHeight: Int,
    val enabled: Boolean,
    val sortOrder: Int,
)

data class SubscriptionItem(
    val id: Int,
    val telegramId: Long,
    val username: String?,
    val firstName: String?,
    val planTitle: String?,
    val serverId: String,
    val isFree: Boolean,
    val isActive: Boolean,
    val dataLimitGb: Double,
    val dataUsedGb: Double,
    val dataLeftGb: Double,
    val expiresAt: String?,
    val daysLeft: Int?,
    val vlessKey: String?,
    val subscriptionUrl: String?,
    val paymentId: Int?,
)
