package com.airvpn.admin

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.airvpn.admin.ui.accounts.AccountsScreen
import com.airvpn.admin.ui.ads.AdsScreen
import com.airvpn.admin.ui.catalog.CatalogScreen
import com.airvpn.admin.ui.components.AdminTopChrome
import com.airvpn.admin.ui.dashboard.DashboardScreen
import com.airvpn.admin.ui.login.LoginScreen
import com.airvpn.admin.ui.payments.PaymentsScreen
import com.airvpn.admin.ui.servers.ServersPlansScreen
import com.airvpn.admin.ui.theme.AirVpnAdminTheme
import com.airvpn.admin.ui.theme.Cyan
import com.airvpn.admin.ui.theme.Hairline
import com.airvpn.admin.ui.theme.InkMuted
import com.airvpn.admin.ui.theme.Navy
import com.airvpn.admin.ui.theme.Night
import com.airvpn.admin.ui.theme.Panel
import com.airvpn.admin.ui.theme.SurfaceBg
import com.airvpn.admin.ui.users.UsersScreen

class MainActivity : ComponentActivity() {
    private var viewModel: AdminViewModel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AirVpnAdminTheme {
                val vm: AdminViewModel = viewModel()
                viewModel = vm
                LaunchedEffect(intent) {
                    handleLoginIntent(intent, vm)
                }
                AdminRoot(vm)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        viewModel?.let { handleLoginIntent(intent, it) }
    }

    companion object {
        fun handleLoginIntent(intent: Intent?, vm: AdminViewModel) {
            val uri = intent?.data ?: return
            parseLoginUri(uri)?.let { (tid, code) ->
                vm.applyLoginDeepLink(tid, code)
            }
        }

        fun parseLoginUri(uri: Uri): Pair<Long, String>? {
            val tid = (
                uri.getQueryParameter("tid")
                    ?: uri.getQueryParameter("telegram_id")
                    ?: ""
            ).filter { it.isDigit() }.toLongOrNull() ?: return null
            val code = (
                uri.getQueryParameter("code")
                    ?: uri.getQueryParameter("otp")
                    ?: ""
            ).filter { it.isDigit() }
            if (tid <= 0 || code.length < 4) return null
            return tid to code
        }
    }
}

private enum class AdminTab(val label: String, val icon: ImageVector) {
    Dashboard("Home", Icons.Outlined.Dashboard),
    Payments("Pay", Icons.Outlined.Payments),
    Accounts("Accts", Icons.Outlined.AccountBalanceWallet),
    Servers("Plans", Icons.Outlined.Dns),
    Users("Users", Icons.Outlined.People),
    Catalog("Catalog", Icons.AutoMirrored.Outlined.ListAlt),
    Ads("Ads", Icons.Outlined.Campaign),
}

@Composable
private fun AdminRoot(vm: AdminViewModel) {
    val state by vm.state.collectAsState()
    val snack = remember { SnackbarHostState() }
    var tab by remember { mutableStateOf(AdminTab.Dashboard) }

    LaunchedEffect(state.message, state.error) {
        state.message?.let {
            snack.showSnackbar(it)
            vm.clearFlash()
        }
        state.error?.let {
            snack.showSnackbar(it)
            vm.clearFlash()
        }
    }

    LaunchedEffect(
        state.booting,
        state.loggedIn,
        state.pendingLoginTid,
        state.pendingLoginCode,
    ) {
        if (!state.booting && !state.loggedIn &&
            state.pendingLoginTid != null &&
            !state.pendingLoginCode.isNullOrBlank()
        ) {
            vm.loginFromPendingDeepLink()
        }
    }

    when {
        state.booting -> {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Night),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Cyan)
            }
        }
        !state.loggedIn -> {
            LoginScreen(
                loading = state.loading,
                error = state.error,
                initialTelegramId = state.pendingLoginTid ?: state.telegramId.takeIf { it > 0 },
                initialCode = state.pendingLoginCode,
                onLogin = vm::login,
            )
        }
        else -> {
            Scaffold(
                containerColor = SurfaceBg,
                topBar = {
                    Column {
                        AdminTopChrome(
                            title = "AirVPN Console",
                            subtitle = "Operator · ${state.telegramId}",
                            onRefresh = { vm.refreshAll() },
                            onLogout = { vm.logout() },
                            refreshIcon = Icons.Outlined.Refresh,
                            logoutIcon = Icons.AutoMirrored.Outlined.Logout,
                        )
                        HorizontalDivider(color = Hairline.copy(alpha = 0.35f), thickness = 1.dp)
                    }
                },
                bottomBar = {
                    NavigationBar(
                        containerColor = Panel,
                        contentColor = InkMuted,
                        tonalElevation = 0.dp,
                    ) {
                        AdminTab.entries.forEach { t ->
                            NavigationBarItem(
                                selected = tab == t,
                                onClick = { tab = t },
                                icon = { Icon(t.icon, contentDescription = t.label) },
                                label = { Text(t.label) },
                                alwaysShowLabel = false,
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Navy,
                                    selectedTextColor = Navy,
                                    indicatorColor = Cyan.copy(alpha = 0.16f),
                                    unselectedIconColor = InkMuted,
                                    unselectedTextColor = InkMuted,
                                ),
                            )
                        }
                    }
                },
                snackbarHost = { SnackbarHost(snack) },
            ) { padding ->
                val mod = Modifier
                    .padding(padding)
                    .fillMaxWidth()
                when (tab) {
                    AdminTab.Dashboard -> DashboardScreen(state.stats, mod)
                    AdminTab.Payments -> PaymentsScreen(
                        payments = state.payments,
                        filter = state.paymentFilter,
                        onFilter = vm::setPaymentFilter,
                        onApprove = vm::approvePayment,
                        onReject = vm::rejectPayment,
                        modifier = mod,
                    )
                    AdminTab.Accounts -> AccountsScreen(
                        accounts = state.accounts,
                        onSave = vm::saveAccount,
                        onToggle = vm::setAccountActive,
                        modifier = mod,
                    )
                    AdminTab.Servers -> ServersPlansScreen(
                        servers = state.servers,
                        plans = state.plans,
                        onSavePlan = vm::savePlan,
                        onTogglePlan = vm::setPlanActive,
                        modifier = mod,
                    )
                    AdminTab.Users -> UsersScreen(
                        users = state.users,
                        query = state.userQuery,
                        onQueryChange = vm::setUserQuery,
                        onSearch = vm::refreshUsers,
                        onBan = vm::banUser,
                        modifier = mod,
                    )
                    AdminTab.Catalog -> CatalogScreen(
                        servers = state.catalog,
                        onSave = vm::saveCatalog,
                        onToggle = vm::setCatalogEnabled,
                        onDelete = vm::deleteCatalog,
                        modifier = mod,
                    )
                    AdminTab.Ads -> AdsScreen(
                        ads = state.ads,
                        onSave = vm::saveAd,
                        onToggle = vm::setAdEnabled,
                        onDelete = vm::deleteAd,
                        onUpload = vm::uploadAdImage,
                        modifier = mod,
                    )
                }
            }
        }
    }
}
