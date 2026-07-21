"""Burmese (my) + English (en) UI strings for AirVPN bot."""
from __future__ import annotations

import html as html_lib
import re

# Older reply-keyboard labels still accepted after renames.
MENU_ALIASES: dict[str, tuple[str, ...]] = {
    "menu_my_key": (
        "My VPN Key",
        "ကျွန်ုပ်၏ VPN Key",
    ),
    "menu_replace": (
        "Change Server",
        "ဆာဗာ ပြောင်းမယ်",
        "Key ပြန်လဲမယ်",
        "Replace Key",
    ),
}

STRINGS: dict[str, dict[str, str]] = {
    "welcome": {
        "my": (
            "<b>AirVPN မှ လှိုက်လှဲစွာ ကြိုဆိုပါတယ်ခင်ဗျာ။</b>\n\n"
            "မြန်မာနိုင်ငံအတွက် အမြန်ဆုံးနဲ့ စိတ်အချရဆုံး VPN ဝန်ဆောင်မှု။\n"
            "အောက်က မီနူးလေးတွေကနေ စိတ်ကြိုက်ရွေးချယ်နိုင်ပါတယ် "
        ),
        "en": (
            "<b>Welcome to AirVPN!</b>\n\n"
            "Fast, secure VPN for Myanmar.\n"
            "Choose an option below "
        ),
    },
    "menu_daily": {"my": "နေ့စဉ် လက်ဆောင်ယူမယ်", "en": "Daily Gift"},
    "menu_buy": {"my": "ပလန် ဝယ်ယူမယ်", "en": "Buy Plan"},
    "menu_my_key": {"my": "ကျွန်ုပ်၏ VPN Key များ", "en": "My VPN Key(s)"},
    "menu_replace": {"my": "Key ပြန်လဲမယ်", "en": "Replace Key"},
    "menu_download": {"my": "App ဒေါင်းလုတ်ဆွဲရန်", "en": "Download VPN Apps"},
    "menu_support": {"my": "အကူအညီ တောင်းရန်", "en": "Support"},
    "menu_lang": {"my": "ဘာသာစကား ပြောင်းရန်", "en": "Language"},
    "menu_restored": {
        "my": "အောက်က မီနူးကနေ ဆက်အသုံးပြုနိုင်ပါတယ်။",
        "en": "Use the menu below to continue.",
    },
    "download_title": {
        "my": (
            "<b>VPN App ဒေါင်းလုတ်ဆွဲရန်</b>\n\n"
            "မိမိအသုံးပြုတဲ့ ဖုန်းအမျိုးအစားအလိုက် အောက်က Link မှာ ဒေါင်းလုတ်လုပ်နိုင်ပါတယ်ခင်ဗျာ "
        ),
        "en": "<b>Download VPN Apps</b>\n\nTap a link below to install ",
    },
    "download_android": {"my": "Android ဖုန်းအတွက်", "en": "Android"},
    "download_ios": {"my": "iOS (iPhone) အတွက်", "en": "iOS"},
    "download_android_apps": {
        "my": (
            "<b>Android VPN Apps</b>\n\n"
            "အောက်က Link လေးတွေကနေ App ကို အရင်ဒေါင်းလုတ်ဆွဲပေးပါ။\n"
            "ပြီးရင်တော့ မိမိရဲ့ VPN Key ကို Import (ထည့်သွင်း) ပြီး အသုံးပြုနိုင်ပါပြီ။"
        ),
        "en": (
            "<b>Android VPN Apps</b>\n\n"
            "Download an app below, then import your VPN key."
        ),
    },
    "download_ios_apps": {
        "my": (
            "<b>iOS VPN Apps</b>\n\n"
            "အောက်က Link လေးတွေကနေ App ကို အရင်ဒေါင်းလုတ်ဆွဲပေးပါ။\n"
            "ပြီးရင်တော့ မိမိရဲ့ VPN Key ကို Import (ထည့်သွင်း) ပြီး အသုံးပြုနိုင်ပါပြီ။"
        ),
        "en": (
            "<b>iOS VPN Apps</b>\n\n"
            "Download an app below, then import your VPN key."
        ),
    },
    "back": {"my": "နောက်သို့", "en": "Back"},
    "cancel": {"my": "မလုပ်တော့ပါ", "en": "Cancel"},
    "daily_title": {
        "my": "<b>နေ့စဉ် အခမဲ့ ဒေတာ ၅၀၀ MB</b>",
        "en": "<b>Daily Free 500 MB</b>",
    },
    "daily_already": {
        "my": (
            "ဒီနေ့အတွက် လက်ဆောင်ကို ရယူပြီးသွားပါပြီ။\n"
            "မနက်ဖြန်ကျရင်ပြန်ယူဖို့ မမေ့နဲ့နော်။"
        ),
        "en": "You already claimed today's gift.\nCome back tomorrow!",
    },
    "daily_disabled": {
        "my": "လက်ရှိတွင် နေ့စဉ် အခမဲ့ လက်ဆောင်ကို ယာယီ ပိတ်ထားပါတယ်။",
        "en": "Daily free gift is currently disabled.",
    },
    "daily_claimed": {
        "my": (
            "<b>လက်ဆောင်လေး ပေးလိုက်ပါပြီနော်။</b>\n\n"
            "ဒီနေ့အတွက် ရရှိတဲ့ဒေတာ: <b>{mb} MB</b>\n"
            "ရက်ဆက် ရယူမှု: <b>{streak} ရက်မြောက်</b>\n"
            "<i>(နေ့စဉ် ၅၀၀ MB အထိပဲ အလိုအလျောက် ပြန်ဖြည့်ပေးမှာမို့ မနက်ဖြန် ပြန်လာ Claim ဖို့ မမေ့ပါနဲ့နော်။)</i>"
        ),
        "en": (
            "<b>Gift claimed!</b>\n\n"
            "Today's data: <b>{mb} MB</b>\n"
            "Streak: <b>{streak} days</b>\n"
            "<i>Resets to 500 MB each day (not stacked)</i>"
        ),
    },
    "daily_free_note": {
        "my": (
            "<i>ပလန် ဝယ်ယူအားပေးထားတဲ့သူတွေလည်း နေ့စဉ် အခမဲ့ Key ကို "
            "သီးသန့် ထပ်ယူလို့ရပါတယ်နော်။</i>"
        ),
        "en": "<i>Paid users also get a separate daily free key alongside their plan keys.</i>",
    },
    "key_copy_hint": {
        "my": "Key ကို ကော်ပီ (Copy) ကူးဖို့ နှိပ်ပေးပါ။",
        "en": "Tap to copy key",
    },
    "key_copy_plain": {
        "my": "အောက်က Key လေးကို တစ်ချက်နှိပ်ပြီး ကော်ပီ (Copy) ယူလိုက်ပါနော်။",
        "en": "Tap and hold below to copy your key",
    },
    "account_copy_hint": {
        "my": "ဖုန်းနံပါတ်ကို Copy ကူးမည်။",
        "en": "Tap to copy account number",
    },
    "daily_free_key": {
        "my": "<b>အခမဲ့ VPN Key (VLESS)</b>",
        "en": "<b>Your free VPN key (VLESS)</b>",
    },
    "sub_link_header": {
        "my": (
            "<b>VPN Subscription Link</b>\n\n"
            "အောက်က <b>Subscription Link ကူးမည်</b> ခလုတ်ကို နှိပ်ပြီး Link ကို Copy ယူပါ။\n"
            "v2rayNG / Hiddify မှာ <b>Subscription</b> အဖြစ် ထည့်သွင်းနိုင်ပါတယ်။\n"
            "ဒေတာလက်ကျန်နဲ့ သက်တမ်းကို App ထဲမှာ တိုက်ရိုက် ကြည့်နိုင်ပါတယ်။"
        ),
        "en": (
            "<b>VPN Subscription Link</b>\n\n"
            "Tap <b>Copy subscription link</b> below, then add it in v2rayNG / Hiddify.\n"
            "Your app will show remaining data and expiry automatically."
        ),
    },
    "sub_copy_hint": {
        "my": "Subscription Link ကူးမည်",
        "en": "Copy subscription link",
    },
    "sub_usage_note": {
        "my": (
            "<i>Key တစ်ခုချင်းစီရဲ့ လက်ကျန်နဲ့သက်တမ်းကို VPN App ထဲမှာ "
            "တိုက်ရိုက် ပြပေးပါလိမ့်မယ်။</i>"
        ),
        "en": (
            "<i>Per-key usage below — your VPN app reads data left and expiry "
            "from the subscription link.</i>"
        ),
    },
    "sub_raw_key_hint": {
        "my": "Tap to Copy",
        "en": "Tap to Copy",
    },
    "sub_raw_key_show": {
        "my": "Key ပြမည်",
        "en": "Show key",
    },
    "daily_key_error": {
        "my": (
            "စနစ်ချို့ယွင်းချက်ကြောင့် VPN Key ထုတ်ပေးလို့ မရသေးပါဘူးခင်ဗျာ။ "
            "ခဏနေမှ ထပ်ကြိုးစားပေးပါ (သို့မဟုတ် Admin ဆီ ဆက်သွယ်ပေးပါ)။"
        ),
        "en": "Could not generate VPN key. Try again later or contact admin.",
    },
    "daily_key_recovered": {
        "my": (
            "<b>VPN Key ပြန်ထုတ်ပေးလိုက်ပါပြီနော်။</b>\n\n"
            "ဒီနေ့အတွက် ဒေတာ: <b>{mb} MB</b>\n"
            "ရက်ဆက် ရယူမှု: <b>{streak} ရက်မြောက်</b>"
        ),
        "en": (
            "<b>Your VPN key is ready.</b>\n\n"
            "Today's data: <b>{mb} MB</b>\n"
            "Streak: <b>{streak} days</b>"
        ),
    },
    "servers_title": {
        "my": "<b>ဆာဗာ တည်နေရာ ရွေးချယ်ပါ</b>",
        "en": "<b>Choose Server</b>",
    },
    "server_not_in_list": {
        "my": (
            "ဤ Server ကို ယခု မရရှိနိုင်ပါ။ အောက်က Server စာရင်းမှ ပြန်ရွေးပါ "
            "(Admin: VPN_SERVERS ထဲမှာ server ID ထည့်ရန် လိုနိုင်သည်)။"
        ),
        "en": (
            "That server is not available. Pick from the list below "
            "(admin: add its ID to VPN_SERVERS if it should be offered)."
        ),
    },
    "plans_title": {
        "my": "<b>အသုံးပြုလိုတဲ့ ပလန်ကို ရွေးချယ်ပေးပါ</b>",
        "en": "<b>Choose a Plan</b>",
    },
    "plans_title_server": {
        "my": "<b>{server}</b> — ပလန် ရွေးချယ်ပါ",
        "en": "<b>{server}</b> — Choose a Plan",
    },
    "plan_item": {
        "my": "{title} | {price:,} ကျပ်",
        "en": "{title} | {price:,} Ks",
    },
    "no_plans": {
        "my": "လက်ရှိမှာ ပလန်တွေ မရှိသေးပါဘူးခင်ဗျာ။ ကျေးဇူးပြုပြီး Admin ထံ ဆက်သွယ်ပေးပါ။",
        "en": "No plans available. Contact admin.",
    },
    "pay_choose_method": {
        "my": "KBZPay နဲ့ ငွေလွှဲပေးပါရန် -",
        "en": "Pay via KBZPay:",
    },
    "pay_instructions": {
        "my": (
            "<b>ငွေပေးချေမှု လမ်းညွှန်လေးပါ</b>\n\n"
            "ဆာဗာ: <b>{server}</b>\n"
            "ရွေးချယ်ထားတဲ့ ပလန်: <b>{plan}</b>\n"
            "ကျသင့်ငွေ: <b>{price:,} ကျပ်</b>\n"
            "ငွေလွှဲနည်းလမ်း: <b>{method}</b>\n"
            "အကောင့်နံပါတ်: <code>{account}</code>\n"
            "အကောင့်အမည်: {account_name}\n\n"
            "<b>ငွေလွှဲပြီးနောက် ၁ နာရီအတွင်း လုပ်ငန်းစဉ်နံပါတ် နောက်ဆုံး ၅ လုံး ပို့ပေးပါ — "
            "၁ နာရီထက်ပိုဟောင်းတဲ့ ငွေလွှဲမှုကို အလိုအလျောက် ငြင်းပယ်ပါမည်။</b>\n\n"
            "လွှဲပြီးပါက <b>လုပ်ငန်းစဉ်နံပါတ်ရဲ့ နောက်ဆုံး ဂဏန်း ၅ လုံး</b> ကို ပို့ပေးပါ။\n"
            "နမူနာကို ပုံတွင် ကြည့်ပါ။\n\n"
            "မလုပ်တော့ပါဆိုရင် /cancel နှိပ်ပါ။"
        ),
        "en": (
            "<b>Payment Instructions</b>\n\n"
            "Server: <b>{server}</b>\n"
            "Plan: <b>{plan}</b>\n"
            "Amount: <b>{price:,} Ks</b>\n"
            "Method: <b>{method}</b>\n"
            "Account: <code>{account}</code>\n"
            "Name: {account_name}\n\n"
            "<b>Within 1 hour of payment, send the last 5 digits of the transaction ID — "
            "transfers older than 1 hour are auto-rejected.</b>\n\n"
            "After transferring, send the <b>last 5 digits</b> of the transaction ID.\n"
            "See the image for an example.\n\n"
            "To cancel, tap /cancel"
        ),
    },
    "pay_waiting_receipt": {
        "my": (
            "လုပ်ငန်းစဉ်နံပါတ်ရဲ့ <b>နောက်ဆုံးဂဏန်း ၅ လုံး</b> အတိအကျ ပို့ပေးပါ။\n"
            "ဥပမာ - <code>{example}</code>\n\n"
            "မလုပ်တော့ပါဆိုရင် /cancel နှိပ်ပါ။"
        ),
        "en": (
            "Please send the exact <b>last 5 digits</b> of the transaction ID.\n"
            "Example: <code>{example}</code>\n\n"
            "To cancel, tap /cancel"
        ),
    },
    "tx_digits_prompt": {
        "my": "လုပ်ငန်းစဉ်နံပါတ်ရဲ့ နောက်ဆုံးဂဏန်း ၅ လုံး အတိအကျပို့ပေးပါ။",
        "en": "Please send the exact last 5 digits of the transaction ID.",
    },
    "tx_digits_invalid": {
        "my": "လုပ်ငန်းစဉ်နံပါတ်ရဲ့ နောက်ဆုံးဂဏန်း ၅ လုံး အတိအကျပို့ပေးပါ။",
        "en": "Please send the exact last 5 digits of the transaction ID.",
    },
    "tx_example_caption": {
        "my": "ဥပမာ - {example}",
        "en": "Eg - {example}",
    },
    "pay_no_pending": {
        "my": (
            "လက်ရှိ စောင့်ဆိုင်းနေတဲ့ ငွေပေးချေမှု မရှိပါဘူးခင်ဗျာ။\n"
            "ပလန် ဝယ်ယူမယ် ကို နှိပ်ပြီး ပြန်စပေးပါ။"
        ),
        "en": (
            "No pending payment found.\n"
            "Tap Buy Plan to start again."
        ),
    },
    "pay_already_processed": {
        "my": (
            "ဒီငွေပေးချေမှုကို စီမံပြီးသွားပါပြီ။\n"
            "ပလန် ဝယ်ယူမယ် ကို နှိပ်ပြီးစ်ပြန်စပေးပါ။"
        ),
        "en": (
            "This payment was already processed.\n"
            "Tap Buy Plan to start a new one."
        ),
    },
    "pay_ask_tx_id": {
        "my": (
            "လုပ်ငန်းစဉ်နံပါတ်ရဲ့ <b>နောက်ဆုံးဂဏန်း ၅ လုံး</b> အတိအကျ ပို့ပေးပါ။\n"
            "ဥပမာ - <code>{example}</code>"
        ),
        "en": (
            "Please send the exact <b>last 5 digits</b> of the transaction ID.\n"
            "Example: <code>{example}</code>"
        ),
    },
    "pay_verifying": {
        "my": "ငွေလွှဲကို စစ်ဆေးနေပါတယ်…",
        "en": "Checking the transaction…",
    },
    "pay_submitted": {
        "my": (
            "<b>သင့်ငွေပေးချေမှုကို စိစစ်နေပါတယ်။</b>\n\n"
            "Admin လက်ခံ/ငြင်းပယ်ပြီးပါက VPN Key ပို့ပေးပါမယ်။"
        ),
        "en": (
            "<b>Your payment is under review.</b>\n\n"
            "We will send your VPN key once Admin accepts it."
        ),
    },
    "pay_approved_auto": {
        "my": (
            "<b>ငွေလွှဲမှု အောင်မြင်ပြီး စနစ်ကနေ အလိုအလျောက် အတည်ပြုပေးလိုက်ပါပြီ။</b>\n\n"
            "ဝယ်ယူထားတဲ့ ပလန်: <b>{plan}</b>\n"
            "ရရှိတဲ့ဒေတာ: <b>{data_gb} GB</b>\n"
            "အသုံးပြုနိုင်မယ့်သက်တမ်း: <b>{days} ရက်</b>"
        ),
        "en": (
            "<b>Payment auto-verified and approved!</b>\n\n"
            "Plan: <b>{plan}</b>\n"
            "Data: <b>{data_gb} GB</b>\n"
            "Valid: <b>{days} days</b>"
        ),
    },
    "pay_rejected_auto": {
        "my": "ငွေပေးချေမှု စစ်ဆေးချက် မကိုက်ညီပါခင်ဗျာ - {reason}",
        "en": "Payment verification failed: {reason}",
    },
    "pay_rejected_generic": {
        "my": (
            "တောင်းပန်ပါတယ်ခင်ဗျာ၊ ငွေပေးချေမှုကို စစ်ဆေးလို့ မရနိုင်လို့ပါ။\n"
            "ငွေလွှဲပြေစာ မှန်ကန်မှု ရှိ/မရှိ ပြန်လည်စစ်ဆေးပြီး ထပ်မံကြိုးစားပေးပါဦး၊ "
            "ဒါမှမဟုတ် Admin ကို ဆက်သွယ်မေးမြန်းနိုင်ပါတယ်။"
        ),
        "en": (
            "Payment could not be verified.\n"
            "Please check your receipt and try again, or contact an admin."
        ),
    },
    "pay_rejected_stale_tx": {
        "my": (
            "ငွေလွှဲမှု ၁ နာရီထက် ပိုဟောင်းနေလို့ အလိုအလျောက် ငြင်းပယ်လိုက်ပါပြီ။\n"
            "နောက်ဆုံးပေါ် ပြေစာနဲ့ ထပ်မံကြိုးစားပေးပါဦး၊ ဒါမှမဟုတ် Admin ကို ဆက်သွယ်ပါ။"
        ),
        "en": (
            "Transaction is over 1 hour old and was auto-rejected.\n"
            "Please pay again with a fresh receipt, or contact an admin."
        ),
    },
    "rate_limited": {
        "my": "ခဏလောက်စောင့်ပြီးမှ ထပ်မံကြိုးစားပေးပါနော်။",
        "en": "Please wait and try again shortly.",
    },
    "rate_limited_receipt": {
        "my": (
            "စနစ်လုံခြုံရေးအရ ငွေလွှဲပြေစာ ပုံကို ၁ မိနစ်အတွင်း ၂ ကြိမ်ထက်ပိုပြီး "
            "ပို့လို့မရပါဘူးခင်ဗျာ။ ခဏလောက်စောင့်ပြီးမှ ထပ်စမ်းကြည့်ပေးပါ။"
        ),
        "en": "You can only send 2 receipt screenshots per minute. Please wait and try again.",
    },
    "pay_approved_user": {
        "my": (
            "<b>ငွေလွှဲမှုကို အတည်ပြုပေးလိုက်ပါပြီခင်ဗျာ။ AirVPN ကို အားပေးတဲ့အတွက် အထူးကျေးဇူးတင်ပါတယ်။</b>\n\n"
            "ဝယ်ယူထားတဲ့ ပလန်: <b>{plan}</b>\n"
            "ရရှိတဲ့ဒေတာ: <b>{data_gb} GB</b>\n"
            "အသုံးပြုနိုင်မယ့်သက်တမ်း: <b>{days} ရက်</b>"
        ),
        "en": (
            "<b>Payment approved!</b>\n\n"
            "Plan: <b>{plan}</b>\n"
            "Data: <b>{data_gb} GB</b>\n"
            "Valid: <b>{days} days</b>"
        ),
    },
    "pay_rejected_user": {
        "my": (
            "စိတ်မကောင်းပါဘူးခင်ဗျာ၊ သင့်ရဲ့ ငွေပေးချေမှုကို ငြင်းပယ်ထားပါတယ်။\n"
            "အကြောင်းပြချက်- {reason}"
        ),
        "en": "Payment rejected.\nReason: {reason}",
    },
    "no_subscription": {
        "my": (
            "သင့်မှာ လက်ရှိ အသုံးပြုနေတဲ့ VPN Key မရှိသေးပါဘူးခင်ဗျာ။\n"
            "နေ့စဉ် လက်ဆောင်ကနေ အခမဲ့ Key ယူပြီး စမ်းသုံးကြည့်နိုင်သလို၊ "
            "ပလန်အသစ် ဝယ်ယူပြီးလည်း သုံးစွဲနိုင်ပါတယ်နော်။"
        ),
        "en": (
            "You don't have a VPN key yet.\n"
            "Claim Daily Gift for a free key, or tap to buy a plan."
        ),
    },
    "replace_no_paid_keys": {
        "my": (
            "ငွေပေးချေပြီး Active ဖြစ်နေတဲ့ VPN Key မရှိသေးပါဘူး။\n"
            "ပလန် ဝယ်ယူမယ် ကနေ အရင်ဝယ်ယူပေးပါ။"
        ),
        "en": (
            "You don't have an active paid VPN key.\n"
            "Tap Buy Plan first."
        ),
    },
    "replace_need_two_servers": {
        "my": "ဆာဗာ ပြောင်းဖို့ Server အနည်းဆုံး ၂ ခု လိုအပ်ပါတယ်။",
        "en": "At least two servers must be configured to change location.",
    },
    "replace_no_other_servers": {
        "my": "ပြောင်းလို့ရတဲ့ အခြား Server မရှိပါဘူး။",
        "en": "No other servers are available to switch to.",
    },
    "replace_finish_payment_first": {
        "my": "ငွေပေးချေမှု မပြီးသေးပါ — /cancel နှိပ်ပြီး ပြန်စပေးပါ။",
        "en": "Finish or cancel your payment first (/cancel).",
    },
    "replace_pick_key": {
        "my": "<b>ဆာဗာ ပြောင်းမည့် VPN Key</b> ကို ရွေးပါ။",
        "en": "<b>Select the VPN key</b> you want to move to another server.",
    },
    "replace_sub_pick": {
        "my": "#{n} {plan} — {server}",
        "en": "#{n} {plan} — {server}",
    },
    "replace_pick_server": {
        "my": (
            "<b>လက်ရှိ Server:</b> {current}\n\n"
            "ပြောင်းလိုသော Server ကို ရွေးပါ။"
        ),
        "en": (
            "<b>Current server:</b> {current}\n\n"
            "Choose the new server."
        ),
    },
    "replace_ask_feedback": {
        "my": (
            "<b>{server}</b> သို့ ပြောင်းမည်။\n\n"
            "ဘာကြောင့် Server ပြောင်းချင်တာလဲ — တိုတိုလေး ရိုက်ပြပေးပါ။"
        ),
        "en": (
            "Moving to <b>{server}</b>.\n\n"
            "Please tell us why you're switching (short feedback):"
        ),
    },
    "replace_working": {
        "my": "Key အသစ်ကို ပြင်ဆင်နေပါတယ်… ခဏလေးစောင့်ပေးပါ။",
        "en": "Setting up your new key… one moment.",
    },
    "replace_done": {
        "my": (
            "<b>Server ပြောင်းပြီးပါပြီ!</b>\n\n"
            "Server: <b>{server}</b>\n"
            "ဒေတာလက်ကျန်: <b>{remaining} GB</b>\n"
            "သက်တမ်း: <b>{expires}</b>\n\n"
            "အောက်က Key / Subscription Link အသစ်ကို App ထဲ Import လုပ်ပါ။"
        ),
        "en": (
            "<b>Server changed!</b>\n\n"
            "Server: <b>{server}</b>\n"
            "Data left: <b>{remaining} GB</b>\n"
            "Expires: <b>{expires}</b>\n\n"
            "Import the new key or subscription link in your VPN app."
        ),
    },
    "replace_same_server": {
        "my": "အဲဒီ Server မှာပဲ ရှိနေပါတယ် — အခြား Server ရွေးပေးပါ။",
        "en": "That's your current server — pick a different one.",
    },
    "replace_adjust_intro": {
        "my": (
            "<b>{server}</b> သို့ ပြောင်းမည်။\n"
            "Server စျေးနှုန်း မတူညီသောကြောင့် လက်ကျန်ကို ညီမျှစွာ ပြင်ဆင်ပေးရပါမည်။\n\n"
            "လက်ရှိ: <b>{current_gb} GB</b> · <b>{current_days}</b> ရက်\n"
            "({from_price} Ks → {to_price} Ks)\n\n"
            "ရွေးချယ်စရာ ၂ ခု — တစ်ခု ရွေးပါ:"
        ),
        "en": (
            "Moving to <b>{server}</b>.\n"
            "Plan prices differ, so your remaining quota will be adjusted fairly.\n\n"
            "Current: <b>{current_gb} GB</b> · <b>{current_days}</b> days\n"
            "({from_price} Ks → {to_price} Ks)\n\n"
            "Pick one of two options:"
        ),
    },
    "replace_adjust_option_keep_days": {
        "my": "{n}) {gb} GB · {days} ရက် (သက်တမ်းထားမည်)",
        "en": "{n}) {gb} GB · {days} days (keep expiry)",
    },
    "replace_adjust_option_keep_data": {
        "my": "{n}) {gb} GB · {days} ရက် (ဒေတာထားမည်)",
        "en": "{n}) {gb} GB · {days} days (keep data)",
    },
    "replace_adjust_pick": {
        "my": "အောက်ပါ ရွေးချယ်စရာ ၂ ခုထဲက တစ်ခု ရွေးပါ။",
        "en": "Please pick one of the two options below.",
    },
    "replace_adjust_failed": {
        "my": "Quota ပြင်ဆင်၍ မရပါ — Admin ထံအကူအညီ တောင်းပါ။",
        "en": "Could not calculate a fair adjustment — contact admin for help.",
    },
    "replace_ask_feedback_adjusted": {
        "my": (
            "<b>{server}</b> သို့ ပြောင်းမည်။\n"
            "ရွေးထားသော quota: <b>{gb} GB</b> · <b>{days}</b> ရက်\n\n"
            "ဘာကြောင့် Server ပြောင်းချင်တာလဲ — တိုတိုလေး ရိုက်ပြပေးပါ။"
        ),
        "en": (
            "Moving to <b>{server}</b>.\n"
            "Selected quota: <b>{gb} GB</b> · <b>{days} days</b>\n\n"
            "Please tell us why you're switching (short feedback):"
        ),
    },
    "replace_no_quota": {
        "my": "ဒေတာ လက်ကျန်မရှိတော့ပါ (သို့) သက်တမ်းကုန်သွားပါပြီ။",
        "en": "No data left or subscription expired.",
    },
    "replace_failed": {
        "my": "Server ပြောင်း၍ မရပါ — Support ကို ဆက်သွယ်ပါ။",
        "en": "Could not change server — contact Support.",
    },
    "replace_server_unavailable": {
        "my": "ရွေးထားတဲ့ Server ကို ယာယီ အသုံးမပြုနိုင်ပါ။",
        "en": "That server is not available right now.",
    },
    "my_keys_title": {
        "my": "<b>ကျွန်ုပ်၏ VPN Key များ</b> ({count} ခု)",
        "en": "<b>My VPN Key(s)</b> ({count})",
    },
    "my_keys_sub_title": {
        "my": "<b>ကျွန်ုပ်၏ VPN Subscription</b> ({count} key)",
        "en": "<b>My VPN Subscription</b> ({count} key(s))",
    },
    "my_key_paid": {
        "my": (
            "<b>#{n} ပလန် Key (ဝယ်ယူထားသော)</b>\n"
            "ပလန်အမျိုးအစား: {plan}\n"
            "အသုံးပြုမှု: {used_gb} / {limit_gb} GB\n"
            "သက်တမ်းကုန်ဆုံးမည့်ရက်: {expires}"
        ),
        "en": (
            "<b>#{n} Paid Key</b>\n"
            "Plan: {plan}\n"
            "Data: {used_gb} / {limit_gb} GB\n"
            "Expires: {expires}"
        ),
    },
    "my_key_free": {
        "my": (
            "<b>နေ့စဉ် အခမဲ့ သုံးစွဲနိုင်သော Key</b>\n"
            "အသုံးပြုမှု: {used_gb} / {limit_gb} GB\n"
            "သက်တမ်းကုန်ဆုံးမည့်ရက်: {expires}"
        ),
        "en": (
            "<b>Daily Free Key</b>\n"
            "Data: {used_gb} / {limit_gb} GB\n"
            "Expires: {expires}"
        ),
    },
    "support": {
        "my": "အခက်အခဲတစ်စုံတစ်ရာ ရှိပါက Admin ထံ တိုက်ရိုက် စာပို့ပြီး မေးမြန်းနိုင်ပါတယ်ခင်ဗျာ။",
        "en": "Contact admin directly for help.",
    },
    "admin_contact_btn": {
        "my": "Admin {n}",
        "en": "Admin {n}",
    },
    "lang_picker": {
        "my": "ဘာသာစကား ရွေးချယ်ပေးပါရန် -",
        "en": "Choose language:",
    },
    "lang_set": {
        "my": "ဘာသာစကားကို မြန်မာဘာသာသို့ ပြောင်းလဲလိုက်ပါပြီ။",
        "en": "Language set to English.",
    },
    "access_denied": {
        "my": "စနစ်စည်းမျဉ်းအရ ဤလုပ်ဆောင်ချက်ကို လုပ်ဆောင်ခွင့် မရှိပါခင်ဗျာ။",
        "en": "Access denied.",
    },
    "banned": {
        "my": "စည်းကမ်းချက် တစ်စုံတစ်ရာကြောင့် သင့်အကောင့်ကို အသုံးပြုခွင့် ပိတ်ပင်ထားပါတယ်ခင်ဗျာ။",
        "en": "Your account is banned.",
    },
    "admin_menu": {
        "my": "<b>Admin Panel</b>",
        "en": "<b>Admin Panel</b>",
    },
    "admin_pending_payments": {"my": "စောင့်ဆိုင်းငွေပေးချေမှု", "en": "Pending Payments"},
    "admin_users": {"my": "အသုံးပြုသူများ", "en": "Users"},
    "admin_users_header": {
        "my": (
            "<b>အသုံးပြုသူများ</b> — စာမျက်နှာ {page}/{total_pages} "
            "(စုစုပေါင်း {total})\n"
        ),
        "en": (
            "<b>Users</b> — Page {page}/{total_pages} ({total} total)\n"
        ),
    },
    "admin_users_row": {
        "my": (
            "{n}. {user} (<code>{telegram_id}</code>)\n"
            "   အခမဲ့: {free} · Paid: {paid}{ban}"
        ),
        "en": (
            "{n}. {user} (<code>{telegram_id}</code>)\n"
            "   Free: {free} · Paid: {paid}{ban}"
        ),
    },
    "admin_users_banned": {"my": " 🚫", "en": " 🚫"},
    "admin_users_empty": {
        "my": "အသုံးပြုသူ မရှိသေးပါ။",
        "en": "No users yet.",
    },
    "admin_users_prev": {"my": "◀ ယခင်", "en": "◀ Prev"},
    "admin_users_next": {"my": "နောက် ▶", "en": "Next ▶"},
    "admin_stats": {"my": "စာရင်းအင်း", "en": "Statistics"},
    "admin_free_gift": {"my": "နေ့စဉ် လက်ဆောင်", "en": "Daily Gift"},
    "admin_free_gift_status": {
        "my": (
            "<b>နေ့စဉ် လက်ဆောင် ဆက်တင်</b>\n\n"
            "အခြေအနေ: <b>{status}</b>\n"
            "ဒေတာ limit: <b>{mb} MB</b> / ရက်"
        ),
        "en": (
            "<b>Daily Gift Settings</b>\n\n"
            "Status: <b>{status}</b>\n"
            "Data limit: <b>{mb} MB</b> / day"
        ),
    },
    "admin_free_gift_on": {"my": "ဖွင့်ထား", "en": "ON"},
    "admin_free_gift_off": {"my": "ပိတ်ထား", "en": "OFF"},
    "admin_free_gift_enable": {"my": "ဖွင့်မည်", "en": "Turn On"},
    "admin_free_gift_disable": {"my": "ပိတ်မည်", "en": "Turn Off"},
    "admin_free_gift_set_mb": {"my": "ဒေတာ MB ပြင်မည်", "en": "Set MB Limit"},
    "admin_free_gift_enter_mb": {
        "my": "နေ့စဉ် လက်ဆောင်ဒေတာ (MB) ရိုက်ထည့်ပါ (ဥပမာ 500):",
        "en": "Enter daily gift data in MB (e.g. 500):",
    },
    "admin_free_gift_mb_invalid": {
        "my": "၁ နှင့် ၁၀၂၄၀၀ ကြား နံပါတ် ရိုက်ထည့်ပေးပါ။",
        "en": "Enter a number between 1 and 102400.",
    },
    "admin_free_gift_mb_saved": {
        "my": "နေ့စဉ် လက်ဆောင်ဒေတာကို <b>{mb} MB</b> သို့ ပြင်ပြီးပါပြီ။",
        "en": "Daily gift data limit set to <b>{mb} MB</b>.",
    },
    "admin_free_gift_toggled": {
        "my": "နေ့စဉ် လက်ဆောင်ကို <b>{status}</b> လုပ်ပြီးပါပြီ။",
        "en": "Daily gift is now <b>{status}</b>.",
    },
    "admin_notifications": {"my": "အကြောင်းကြားချက်", "en": "Notifications"},
    "admin_notify_menu": {
        "my": "<b>အကြောင်းကြားချက် ပို့မည်</b>",
        "en": "<b>Send Notification</b>",
    },
    "admin_notify_send": {"my": "အသစ်ပို့မည်", "en": "Send New"},
    "admin_notify_history": {"my": "မှတ်တမ်း", "en": "History"},
    "admin_notify_pick_audience": {
        "my": "ပို့မည့် အုပ်စု ရွေးပါ:",
        "en": "Choose audience:",
    },
    "admin_notify_all": {"my": "အသုံးပြုသူ အားလုံး", "en": "All Users"},
    "admin_notify_active": {
        "my": "Active VPN ရှိသူများ",
        "en": "Active Subscribers",
    },
    "admin_notify_enter_message": {
        "my": "ပို့မည့် စာသား ရိုက်ထည့်ပါ (ပယ်ဖျက်ရန် /cancel):",
        "en": "Enter notification message (or /cancel):",
    },
    "admin_notify_sent": {
        "my": (
            "<b>ပို့ပြီးပါပြီ!</b>\n\n"
            "အုပ်စု: {audience}\n"
            "အောင်မြင်: {sent}\n"
            "မအောင်မြင်: {failed}"
        ),
        "en": (
            "<b>Notification sent!</b>\n\n"
            "Audience: {audience}\n"
            "Delivered: {sent}\n"
            "Failed: {failed}"
        ),
    },
    "admin_notify_no_history": {
        "my": "အကြောင်းကြားချက် မှတ်တမ်း မရှိသေးပါ။",
        "en": "No notifications sent yet.",
    },
    "admin_notify_history_item": {
        "my": "#{id} — {audience} — {sent} {failed} — {date}",
        "en": "#{id} — {audience} — {sent} {failed} — {date}",
    },
    "user_notification": {
        "my": "<b>AirVPN အကြောင်းကြားချက်</b>\n\n{message}",
        "en": "<b>AirVPN Announcement</b>\n\n{message}",
    },
    "admin_no_pending": {
        "my": "စောင့်ဆိုင်းနေသော ငွေပေးချေမှု မရှိပါ။",
        "en": "No pending payments.",
    },
    "admin_payment_detail": {
        "my": (
            "<b>ငွေပေးချေမှု #{id}</b>\n\n"
            "အသုံးပြုသူ: {user}\n"
            "ပလန်: {plan} ({price:,} Ks)\n"
            "နည်းလမ်း: {method}\n"
            "အချိန်: {created}"
        ),
        "en": (
            "<b>Payment #{id}</b>\n\n"
            "User: {user}\n"
            "Plan: {plan} ({price:,} Ks)\n"
            "Method: {method}\n"
            "Time: {created}"
        ),
    },
    "admin_approve": {"my": "အတည်ပြုမည်", "en": "Approve"},
    "admin_reject": {"my": "ငြင်းပယ်မည်", "en": "Reject"},
    "admin_approved_ok": {
        "my": "အတည်ပြုပြီး VLESS key ပို့ပြီးပါပြီ။",
        "en": "Approved and VLESS key sent.",
    },
    "admin_payment_not_found": {
        "my": "ငွေပေးချေမှု မတွေ့ပါ။",
        "en": "Payment not found.",
    },
    "admin_payment_already_processed": {
        "my": "ဤငွေပေးချေမှုကို စီမံပြီးသားဖြစ်ပါသည်။",
        "en": "This payment was already processed.",
    },
    "admin_approve_failed": {
        "my": "အတည်ပြုမှု မအောင်မြင်ပါ။ Server log ကို စစ်ဆေးပါ။",
        "en": "Approval failed. Check server logs.",
    },
    "admin_reject_reason": {
        "my": "ငြင်းပယ်ရခြင်း အကြောင်းပြချက် ရိုက်ထည့်ပါ:",
        "en": "Enter rejection reason:",
    },
    "admin_reject_reason_group": {
        "my": "Payment #{payment_id} — ငြင်းပယ်ရခြင်း အကြောင်းပြချက် ရိုက်ထည့်ပါ:",
        "en": "Payment #{payment_id} — reply with the rejection reason:",
    },
    "admin_ban": {"my": "Ban/Unban", "en": "Ban/Unban"},
    "admin_ban_enter": {
        "my": (
            "Ban/Unban လုပ်မည့် Telegram ID ရိုက်ထည့်ပါ:\n"
            "(Ban လုပ်ပါက VPN key အားလုံး panel မှ ဖျက်ပြီး ပိတ်ပင်မည်)"
        ),
        "en": (
            "Enter the Telegram user ID to ban or unban:\n"
            "(Banning removes all VPN keys from the panel.)"
        ),
    },
    "admin_ban_not_found": {
        "my": "အသုံးပြုသူ မတွေ့ပါ (bot ကို /start မနှိပ်ရသေးပါ)။",
        "en": "User not found (they may not have started the bot).",
    },
    "admin_ban_admin_denied": {
        "my": "Admin account ကို ban မလုပ်နိုင်ပါ။",
        "en": "Cannot ban an admin account.",
    },
    "admin_banned_ok": {
        "my": (
            "User {telegram_id} ကို ban လုပ်ပြီးပါပြီ။\n"
            "VPN key ဖျက်ပြီး: {keys_removed}\n"
            "Panel error: {panel_failures}"
        ),
        "en": (
            "User {telegram_id} has been banned.\n"
            "VPN keys removed: {keys_removed}\n"
            "Panel errors: {panel_failures}"
        ),
    },
    "admin_unbanned_ok": {
        "my": "User {telegram_id} ကို unban လုပ်ပြီးပါပြီ။",
        "en": "User {telegram_id} has been unbanned.",
    },
    "admin_stats_loading": {
        "my": "စာရင်းအင်း ရယူနေပါတယ်…",
        "en": "Loading statistics…",
    },
    "admin_stats_usage_live": {
        "my": "panel မှ live",
        "en": "live from panel",
    },
    "admin_stats_usage_cached": {
        "my": "DB cache",
        "en": "cached in DB",
    },
    "admin_stats_text": {
        "my": (
            "<b>စာရင်းအင်း</b>\n\n"
            "<b>အသုံးပြုသူ</b>\n"
            "စုစုပေါင်း: {users}\n"
            "Ban ခံရသူ: {banned}\n"
            "Active VPN ရှိသူ: {active_users}\n\n"
            "<b>VPN Keys (အသက်ဝင်)</b>\n"
            "စုစုပေါင်း: {active_keys}\n"
            "Paid: {paid_keys} · Free: {free_keys}\n"
            "{keys_by_server}\n\n"
            "<b>ဒေတာ အသုံးပြုမှု</b>\n"
            "သုံးပြီး: {used_gb} GB / {limit_gb} GB ({usage_note})\n\n"
            "<b>ငွေပေးချေမှု</b>\n"
            "စောင့်ဆိုင်း: {pending}\n"
            "အတည်ပြုပြီး: {approved}\n"
            "ငြင်းပယ်: {rejected}\n"
            "ဝင်ငွေ (approved): {revenue_ks:,} Ks"
        ),
        "en": (
            "<b>Statistics</b>\n\n"
            "<b>Users</b>\n"
            "Total: {users}\n"
            "Banned: {banned}\n"
            "With active VPN: {active_users}\n\n"
            "<b>Active VPN Keys</b>\n"
            "Total: {active_keys}\n"
            "Paid: {paid_keys} · Free: {free_keys}\n"
            "{keys_by_server}\n\n"
            "<b>Data Usage</b>\n"
            "Used: {used_gb} GB / {limit_gb} GB ({usage_note})\n\n"
            "<b>Payments</b>\n"
            "Pending: {pending}\n"
            "Approved: {approved}\n"
            "Rejected: {rejected}\n"
            "Revenue (approved): {revenue_ks:,} Ks"
        ),
    },
}


def t(lang: str, key: str, **kwargs) -> str:
    block = STRINGS.get(key, {})
    text = block.get(lang) or block.get("my") or key
    if kwargs:
        return text.format(**kwargs)
    return text


def t_plain(lang: str, key: str, **kwargs) -> str:
    """Plain text for popup alerts (no HTML)."""
    raw = t(lang, key, **kwargs)
    return re.sub(r"<[^>]+>", "", html_lib.unescape(raw))
