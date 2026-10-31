/**
 * Phase 7a (#296) — the words a shopkeeper types for an item, and the words on
 * the item. ONE list, used by item search (lib/item-search.ts); the voice
 * parser's prompt names a few of the same pairs in prose.
 *
 * Each group is one thing in several spellings and languages, the word shops
 * usually PRINT first. A query word that is (or begins, from 4 letters) one of
 * these words also matches items named with any other word of its group:
 * "cheeni" finds "Sugar (loose)", "namak" finds "Tata Salt", "चीनी" finds Sugar
 * too, because lib/resolve-name.ts's normalise() turns Hindi script into the
 * same Latin letters before comparing.
 *
 * Kept to single words on purpose: "kali mirch" or "cold drink" as phrases
 * would need phrase matching, and a wrong guess here puts the wrong item first.
 * A brand is never a synonym ("surf" is Surf Excel, not every detergent).
 * Per-item local names (a shop's own word for one item) belong to the item,
 * not to this list — Catalog Studio, Phase 10.
 */
export const SHOP_WORD_GROUPS: readonly (readonly string[])[] = [
  // staples
  ['sugar', 'chini', 'cheeni', 'shakkar', 'shakar', 'sakhar', 'sakkar'],
  ['salt', 'namak'],
  ['atta', 'aata', 'flour', 'gehun', 'gehu'],
  ['rice', 'chawal', 'chaawal', 'chaval'],
  ['dal', 'daal', 'dhal', 'pulses', 'lentil', 'lentils'],
  ['toor', 'tuar', 'tur', 'arhar'],
  ['moong', 'mung'],
  ['chana', 'channa', 'chickpea', 'chickpeas', 'chole', 'chhole'],
  ['urad', 'udad'],
  ['masoor', 'masur'],
  ['oil', 'tel'],
  ['mustard', 'sarson', 'sarso'],
  ['ghee', 'ghi'],
  ['besan', 'gramflour'],
  ['suji', 'sooji', 'rava', 'rawa', 'semolina'],
  ['poha', 'chivda', 'chiwda'],
  ['murmura', 'mamra', 'kurmura'],
  ['jaggery', 'gud', 'gur'],
  // dairy and fresh
  ['milk', 'doodh', 'dudh'],
  ['curd', 'dahi', 'yogurt', 'yoghurt'],
  ['butter', 'makhan', 'makkhan'],
  ['egg', 'eggs', 'anda', 'ande'],
  ['bread', 'pav', 'paav'],
  ['potato', 'aloo', 'alu'],
  ['onion', 'pyaz', 'pyaaz', 'kanda'],
  ['tomato', 'tamatar'],
  ['garlic', 'lahsun', 'lehsun'],
  ['ginger', 'adrak'],
  ['lemon', 'nimbu', 'nimboo'],
  ['vegetables', 'sabzi', 'sabji'],
  // spices
  ['turmeric', 'haldi'],
  ['chilli', 'chili', 'mirch', 'mirchi'],
  ['coriander', 'dhaniya', 'dhania'],
  ['cumin', 'jeera', 'jira', 'zeera'],
  ['fenugreek', 'methi'],
  ['carom', 'ajwain', 'ajwayan'],
  ['fennel', 'saunf', 'sonf'],
  ['cardamom', 'elaichi', 'ilaichi'],
  ['cinnamon', 'dalchini'],
  ['clove', 'cloves', 'laung'],
  // drinks and snacks
  ['tea', 'chai', 'chay', 'chaipatti'],
  ['coffee', 'kofi'],
  ['water', 'paani', 'pani'],
  ['biscuit', 'biscuits', 'biskut', 'biskit', 'cookie', 'cookies'],
  ['namkeen', 'snack', 'snacks'],
  ['chips', 'wafers', 'wafer'],
  ['pickle', 'achar', 'achaar'],
  ['almond', 'almonds', 'badam'],
  ['cashew', 'cashews', 'kaju'],
  ['raisin', 'raisins', 'kishmish', 'kismis'],
  ['walnut', 'walnuts', 'akhrot'],
  ['pistachio', 'pista'],
  ['dates', 'khajur'],
  ['peanut', 'peanuts', 'moongphali', 'mungfali', 'singdana'],
  ['isabgol', 'isabgul', 'isabgoal', 'isobgol', 'psyllium'],
  // household
  ['soap', 'sabun', 'saabun'],
  ['toothpaste', 'manjan'],
  ['matchbox', 'machis', 'maachis'],
  ['incense', 'agarbatti', 'agarbati', 'dhoop'],
  ['candle', 'mombatti', 'mombati'],
  ['broom', 'jhadu', 'jharu'],
  ['polythene', 'polybag', 'thaili', 'carrybag'],
  ['battery', 'batteries', 'cell'],
  ['bulb', 'lattu'],
]

/** Units written many ways on items and in what people type. Compared as one word. */
export const UNIT_WORD_GROUPS: readonly (readonly string[])[] = [
  ['g', 'gm', 'gms', 'gram', 'grams', 'gr'],
  ['kg', 'kgs', 'kilo', 'kilos', 'kilogram'],
  ['l', 'ltr', 'lt', 'litre', 'liter', 'litres', 'liters'],
  ['ml', 'mls'],
  ['pcs', 'pc', 'piece', 'pieces', 'nos'],
  ['pack', 'packet', 'packets', 'pkt'],
  ['dozen', 'dz', 'darjan'],
]

/** Words in a query that carry no meaning for matching ("rs 10" means 10). */
export const QUERY_NOISE_WORDS: readonly string[] = ['rs', 'rupees', 'rupaye', 'rupay', 'inr']
