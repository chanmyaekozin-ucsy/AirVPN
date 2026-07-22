package com.airvpn.admin

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ListAlt
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.lifecycle.viewmodel.compose.viewModel
import com.airvpn.admin.ui.accounts.AccountsScreen
import com.airvpn.admin.ui.ads.AdsScreen
import com.airvpn.admin.ui.catalog.CatalogScreen
import com.airvpn.admin.ui.dashboard.DashboardScreen
import com.airvpn.admin.ui.login.LoginScreen
import com.airvpn.admin.ui.payments.PaymentsScreen
import com.airvpn.admin.ui.servers.ServersPlansScreen
import com.airvpn.admin.ui.theme.AirVpnAdminTheme
import com.airvpn.admin.ui.theme.Navy
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

@OptIn(ExperimentalMaterial3Api::class)
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

    // Auto-login exactly once when a deep link provided credentials
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
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Navy)
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
                topBar = {
                    TopAppBar(
                        title = { Text("AirVPN Admin") },
                        actions = {
                            IconButton(onClick = { vm.refreshAll() }) {
                                Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
                            }
                            IconButton(onClick = { vm.logout() }) {
                                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = "Logout")
                            }
                        },
                    )
                },
                bottomBar = {
                    NavigationBar {
                        AdminTab.entries.forEach { t ->
                            NavigationBarItem(
                                selected = tab == t,
                                onClick = { tab = t },
                                icon = { Icon(t.icon, contentDescription = t.label) },
                                label = { Text(t.label) },
                                alwaysShowLabel = false,
                            )
                        }
                    }
                },
                snackbarHost = { SnackbarHost(snack) },
            ) { padding ->
                val mod = Modifier.padding(padding)
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
