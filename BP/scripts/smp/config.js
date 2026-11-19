// ---------------------------------------------------------------------------------------------
// SMP systems - settings you can edit safely
// ---------------------------------------------------------------------------------------------

// The "day" of the daily reward changes at midnight of this time zone (hours from UTC). Iraq = 3.
export const UTC_OFFSET_HOURS = 3;

// Daily reward cycle: 10 days, then it starts again from day 1 while the streak goes on (miss a day = back to day 1).
//   money / shards = amount,  items = [["item_id", amount], ...],  spawners = [["mob", amount], ...]  (stacked-spawner items)
//   rare: true  = gold name + star in the menu,   icon = texture shown in the menu (optional)
export const DAILY = [
  /* 1  */ { money: 500, items: [["bread", 16]] },
  /* 2  */ { money: 750, items: [["iron_ingot", 8]] },
  /* 3  */ { shards: 5, items: [["cooked_beef", 24]] },
  /* 4  */ { money: 1500, items: [["gold_ingot", 6]] },
  /* 5  */ { shards: 10, items: [["emerald", 4]] },
  /* 6  */ { money: 3000, items: [["diamond", 2]] },
  /* 7  */ { money: 5000, spawners: [["skeleton", 1]], rare: true, icon: "textures/ui/shop/ic_spawner" },
  /* 8  */ { money: 5000, items: [["netherite_ingot", 1]], rare: true, icon: "textures/items/netherite_ingot" },
  /* 9  */ { shards: 20, money: 4000, items: [["diamond", 4], ["golden_apple", 2]] },
  /* 10 */ { money: 10000, shards: 50, spawners: [["skeleton", 1]], rare: true, icon: "textures/ui/shop/ic_spawner" },
];

// Notification center: how many notifications are kept per player
export const NOTES_MAX = 30;
