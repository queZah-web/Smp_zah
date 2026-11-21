// Translations: English (the original texts) and Arabic.
//   t(player, "key", a, b...)  ->  the text in the player's language ({0}, {1}... are replaced by the extra arguments).
//   A key that is missing in Arabic falls back to English, so a half-finished Arabic file never shows an empty button.
//   A key missing everywhere shows the key itself (easy to spot).
//   Arabic is written here as normal (logical) Arabic; t() joins the letters and puts the text right-to-left (arabic.js).
//   Tip for Arabic texts that have colour codes: start the line with a colour code (for example "§7...").
// To go back to English everywhere: set  FORCE_ENGLISH = true  below.
import { getLang } from "./lang.js";
import { arText } from "./arabic.js";

export const FORCE_ENGLISH = false;

export const STR = {
  en: {
    // ---- general
    "click.open": "Click to open",
    "click.teleport": "Click to teleport",
    "click.claim": "Click to claim",
    // ---- SMP Menu (dashboard)
    "menu.title": "§r§f\uE100\uE101\uE102\uE103\uE104\uE105\uE106 \uE107\uE108\uE109\uE10A§r",   // 『Zyther Smp』 in green (custom letters: RP/font/glyph_E1.png)
    "menu.button": "§6§lSMP Menu\n§r§7Statistics, achievements,\n§r§7daily reward and more",
    "menu.button.daily": "\n§r§aDaily reward ready!",
    "menu.button.new1": "\n§r§e{0} new notification",
    "menu.button.newN": "\n§r§e{0} new notifications",
    "spawn.name": "Spawn", "spawn.lines": ["Teleport to the spawn"],
    "homes.name": "Homes", "homes.lines": ["Add, delete or go to a home"],
    "rtp.name": "Join a Random Place", "rtp.lines": ["Random teleport: surface or cave"],
    "tpa.name": "Teleport Requests", "tpa.lines": ["TPA, TP Here and approve"], "tpa.waiting": "§e1 request waiting!",
    "shop.name": "Shop", "shop.lines": ["Buy, sell, shards, levels"],
    "pay.name": "Pay", "pay.lines": ["Send money to a player"],
    "ah.name": "Auction House", "ah.lines": ["Buy and sell items with players"],
    "orders.name": "Orders", "orders.lines": ["Ask for items, players sell them to you"],
    "ranks.name": "Ranks", "ranks.lines": ["Top money, clans, duel, sell, buy"],
    "warps.name": "Warps", "warps.one": "1 warp available", "warps.many": "{0} warps available", "warps.none": "No warps yet", "warps.tp": "Teleport to server locations",
    "profile.text": "§e§l{0}\n§r§7Money: §a{1}\n§r§7Shards: §d{2}\n§r§7Playtime: §f{3}\n§r§7Buyer Lv §f{4} §7| Seller Lv §f{5}\n§r§7Achievements: §f{6}§7/§f{7} §7(§e{8} AP§7)\n§r§7Daily streak: §f{9} {10}",
    "day": "day", "days": "days",
    "skills.name": "Skills", "skills.lines": ["Mining, Combat, Flying...", "levels, rewards and abilities"],
    "abilities.name": "Abilities", "abilities.lines": ["Everything you unlock from", "levels, in one page"],
    "stats.name": "Statistics", "stats.lines": ["Blocks, kills, trades, playtime..."],
    "ach.name": "Achievements", "ach.unlocked": "{0}/{1} unlocked", "ach.ready": "§aMission reward ready!",
    "daily.name": "Daily Reward", "daily.available": "§aAvailable now!", "daily.next": "Next reward in §f{0}", "daily.streak": "Streak: §f{0}",
    "notif.name": "Notifications", "notif.new": "§e{0} new", "notif.none": "No new notifications",
    "nt.go": "§r§eClick to open: §f{0}", "nt.noway": "§r§8(nothing to open)",
    "nt.d.orders": "Orders", "nt.d.ah": "Auction House", "nt.d.clan": "Clans", "nt.d.skills": "Skills", "nt.d.ranks": "Ranks",
    "nt.d.daily": "Daily Reward", "nt.d.pay": "Pay", "nt.d.missions": "Missions", "nt.d.profile": "Profile & Badges", "nt.d.ach": "Achievements",
    "nt.guide.title": "How to get there", "nt.guide.cant": "§c§lYou can't open it from here\n§r§7{0}", "nt.guide.step": "§e§lStep {0}\n§r§f{1}",
    "nt.r.clan": "You are already in a clan, so you can't accept this invitation.", "nt.r.err": "This page did not open from here.",
    "nt.p.menu": "Type /menu", "nt.p.open": "Click: {0}", "nt.p.or2": "Then click: My orders", "nt.p.ah2": "Then click: My listings",
    "nt.p.leave": "Leave your current clan", "nt.p.again": "Open Clans again and accept the invitation",
    "clans.name": "Clans", "clans.lines": ["Create or manage your clan"],
    "mining.name": "Mining Tools", "mining.lines": ["Timber, Vein, Area, Magnet,", "Auto-Smelt, Chest Sell"],
    "land.name": "Land Protection", "land.lines": ["Protect your base (paid by the hour)"],
    "nv.name": "Night Vision", "nv.lines": ["Paid time + ON / OFF"],
    "afk.name": "AFK Area", "afk.lines": ["Go to the AFK area and earn", "money + shards every minute"],
    "cos.name": "Cosmetics", "cos.lines": ["Titles, name colors, particle trails,", "effects and sounds"],
    "crowns.name": "Crowns", "crowns.lines": ["Choose the crown you wear:", "Duel Crown (top kills) or Frost Crown (richest)"],
    "sellslot.name": "Red Sell Slot", "sellslot.now": "Now: §f{0}", "sellslot.where": "Top-right slot of your backpack", "sellslot.desc": "Items moved into it are sold at once", "sellslot.on": "§aON", "sellslot.off": "§cOFF", "sellslot.turnon": "Click to turn ON", "sellslot.turnoff": "Click to turn OFF",
    "lang.name": "Language / اللغة", "lang.now": "Now: §f{0}", "lang.choose": "Choose Arabic or English", "lang.ar": "العربية (Arabic)", "lang.en": "English",
    "lp.title": "Language / اللغة", "lp.ar": "§b§lالعربية\n§r§7Arabic", "lp.en": "§b§lEnglish\n§r§7الإنجليزية", "lp.selected": "§aSelected ✔", "lp.select": "§eClick to select",
    "tip.text": "§eTip\n§r§7Sneak + right-click a Clock\n§r§7opens this menu.\n§r§7A normal click opens the shop.",
    "settings.name": "Settings", "settings.lines": ["Chat messages, join message"],
  },
  ar: {
    "click.open": "اضغط للفتح",
    "click.teleport": "اضغط للانتقال",
    "click.claim": "اضغط للاستلام",
    "menu.title": "§r§f\uE100\uE101\uE102\uE103\uE104\uE105\uE106 \uE107\uE108\uE109\uE10A§r",
    "menu.button": "§6§lقائمة SMP\n§r§7الإحصائيات والإنجازات\n§r§7والمكافأة اليومية والمزيد",
    "menu.button.daily": "\n§r§aالمكافأة اليومية جاهزة!",
    "menu.button.new1": "\n§r§eلديك إشعار جديد واحد",
    "menu.button.newN": "\n§r§eلديك {0} إشعارات جديدة",
    "spawn.name": "نقطة البداية", "spawn.lines": ["الانتقال إلى نقطة البداية"],
    "homes.name": "المنازل", "homes.lines": ["أضف منزلاً أو احذفه أو اذهب إليه"],
    "rtp.name": "انضم إلى مكان عشوائي", "rtp.lines": ["انتقال عشوائي: السطح أو الكهف"],
    "tpa.name": "طلبات الانتقال", "tpa.lines": ["أرسل طلب انتقال أو وافق عليه"], "tpa.waiting": "§eيوجد طلب بالانتظار!",
    "shop.name": "المتجر", "shop.lines": ["شراء وبيع وشظايا ومستويات"],
    "pay.name": "الدفع", "pay.lines": ["أرسل المال إلى لاعب"],
    "ah.name": "دار المزادات", "ah.lines": ["بع واشترِ العناصر مع اللاعبين"],
    "orders.name": "الطلبات", "orders.lines": ["اطلب عناصر ويبيعها لك اللاعبون"],
    "ranks.name": "التصنيفات", "ranks.lines": ["الأكثر مالاً والعشائر والمبارزة والبيع والشراء"],
    "warps.name": "نقاط الانتقال", "warps.one": "نقطة انتقال واحدة متاحة", "warps.many": "{0} نقاط انتقال متاحة", "warps.none": "لا توجد نقاط انتقال بعد", "warps.tp": "انتقل إلى أماكن السيرفر",
    "profile.text": "§e§l{0}\n§r§7المال: §a{1}\n§r§7الشظايا: §d{2}\n§r§7وقت اللعب: §f{3}\n§r§7مستوى المشتري: §f{4}\n§r§7مستوى البائع: §f{5}\n§r§7الإنجازات: §f{6}§7/§f{7} §7| §e{8} نقطة\n§r§7سلسلة الأيام: §f{9} {10}",
    "day": "يوم", "days": "أيام",
    "skills.name": "المهارات", "skills.lines": ["التعدين والقتال والطيران...", "مستويات ومكافآت وقدرات"],
    "abilities.name": "القدرات", "abilities.lines": ["كل ما تفتحه من المستويات", "في صفحة واحدة"],
    "stats.name": "الإحصائيات", "stats.lines": ["الكتل والقتل والصفقات ووقت اللعب..."],
    "ach.name": "الإنجازات", "ach.unlocked": "المفتوح: {0}/{1}", "ach.ready": "§aمكافأة المهمة جاهزة!",
    "daily.name": "المكافأة اليومية", "daily.available": "§aمتاحة الآن!", "daily.next": "§7المكافأة التالية بعد §f{0}", "daily.streak": "§7السلسلة: §f{0}",
    "notif.name": "الإشعارات", "notif.new": "§eجديد: {0}", "notif.none": "لا توجد إشعارات جديدة",
    "nt.go": "§r§eاضغط للفتح: §f{0}", "nt.noway": "§r§8(لا يوجد شيء للفتح)",
    "nt.d.orders": "الطلبات", "nt.d.ah": "دار المزادات", "nt.d.clan": "العشائر", "nt.d.skills": "المهارات", "nt.d.ranks": "التصنيفات",
    "nt.d.daily": "المكافأة اليومية", "nt.d.pay": "الدفع", "nt.d.missions": "المهام", "nt.d.profile": "الملف والألقاب", "nt.d.ach": "الإنجازات",
    "nt.guide.title": "كيف توصل له", "nt.guide.cant": "§c§lلا تستطيع فتحه من هنا\n§r§7{0}", "nt.guide.step": "§e§lالخطوة {0}\n§r§f{1}",
    "nt.r.clan": "أنت داخل عشيرة بالفعل، فلا يمكنك قبول هذه الدعوة.", "nt.r.err": "تعذّر فتح هذه الصفحة من هنا.",
    "nt.p.menu": "اكتب /menu", "nt.p.open": "اضغط: {0}", "nt.p.or2": "ثم اضغط: طلباتي", "nt.p.ah2": "ثم اضغط: قوائمي",
    "nt.p.leave": "اخرج من عشيرتك الحالية", "nt.p.again": "افتح العشائر مرة ثانية واقبل الدعوة",
    "clans.name": "العشائر", "clans.lines": ["أنشئ عشيرتك أو أدرها"],
    "mining.name": "أدوات التعدين", "mining.lines": ["قطع الأشجار والعروق والمنطقة والمغناطيس", "الصهر التلقائي وبيع الصندوق"],
    "land.name": "حماية الأرض", "land.lines": ["احمِ قاعدتك (الدفع بالساعة)"],
    "nv.name": "الرؤية الليلية", "nv.lines": ["وقت مدفوع + تشغيل / إيقاف"],
    "afk.name": "منطقة AFK", "afk.lines": ["اذهب إلى منطقة AFK واكسب", "مالاً وشظايا كل دقيقة"],
    "cos.name": "التجميليات", "cos.lines": ["الألقاب وألوان الاسم ومسارات الجسيمات", "والمؤثرات والأصوات"],
    "crowns.name": "التيجان", "crowns.lines": ["اختر التاج الذي ترتديه:", "تاج المبارزة (أعلى قتلى) أو تاج الصقيع (الأغنى)"],
    "sellslot.name": "خانة البيع الحمراء", "sellslot.now": "§7الآن: §f{0}", "sellslot.where": "الخانة العلوية اليمنى في شنطتك", "sellslot.desc": "العناصر التي تنقلها إليها تُباع فوراً", "sellslot.on": "§aمشغّلة", "sellslot.off": "§cمطفأة", "sellslot.turnon": "اضغط للتشغيل", "sellslot.turnoff": "اضغط للإطفاء",
    "lang.name": "اللغة / Language", "lang.now": "§7الآن: §f{0}", "lang.choose": "اختر العربية أو الإنجليزية", "lang.ar": "العربية (Arabic)", "lang.en": "English",
    "lp.title": "اللغة / Language", "lp.ar": "§b§lالعربية\n§r§7Arabic", "lp.en": "§b§lEnglish\n§r§7الإنجليزية",
    "lp.select": "§eاضغط للاختيار", "lp.selected": "§aالمختارة ✔",
    "tip.text": "§eنصيحة\n§r§7اضغط يمين مع الانحناء على ساعة\n§r§7لفتح هذه القائمة.\n§r§7النقر العادي يفتح المتجر.",
    "settings.name": "الإعدادات", "settings.lines": ["رسائل الشات ورسالة الدخول"],
  },
};

function pick(player, key, args) {
  const lang = FORCE_ENGLISH ? "en" : getLang(player);
  const v = STR[lang]?.[key] ?? STR.en[key];
  if (v === undefined) return undefined;
  const fill = (x) => (typeof x === "string" && args.length ? x.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : x);
  return Array.isArray(v) ? v.map(fill) : fill(v);
}

/** the translated text (string, or array of lines) of a key for this player.  Arabic comes back joined and right-to-left, ready to show.
 *  Do NOT give the result of t() to another t() as an argument (it is already finished): use tr() for that. */
export function t(player, key, ...args) {
  const v = pick(player, key, args);
  if (v === undefined) return key;
  if (Array.isArray(v)) return v.flatMap((x) => String(arText(x)).split("\n"));      // one array item per line (a long Arabic line becomes two items)
  return arText(v);
}

/** the same text but NOT yet shaped: only for putting it inside another text that goes through t() */
export function tr(player, key, ...args) {
  const v = pick(player, key, args);
  return v === undefined ? key : v;
}
