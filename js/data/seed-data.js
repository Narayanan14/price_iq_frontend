// Static seed definitions for the synthetic PriceIQ dataset.
// Everything here is illustrative: categories, products, brands and suppliers are fictional
// demonstration values and are NOT taken from any real retailer or the UCI Online Retail dataset.

export const DATA_SEED = 20251006;

/** 52 historical weeks (Mondays) followed by the forecast horizon. */
export const HISTORY_START = '2025-10-06';
export const HISTORY_WEEKS = 52;
export const FORECAST_START = '2026-10-05';
export const AS_OF_DATE = '2026-10-04';

export const FORECAST_PERIODS = [1, 2, 4, 8, 12];
export const DEFAULT_PERIOD = 4;

/**
 * Illustrative customer segments. Labels mirror the intended RFM/K-Means output,
 * but these are assumptions — the clustering model has not been trained yet.
 * elasticityMultiplier scales a product's base price sensitivity for this segment.
 */
export const SEGMENTS = [
  {
    id: 1,
    key: 'loyalists',
    name: 'High-Value Loyalists',
    short: 'Loyalists',
    color: '#3730A3',
    elasticityMultiplier: 0.6,
    unitShare: 0.38,
    customerShare: 0.12,
    description: 'Recent, frequent, high-spend customers. Least responsive to price changes in this simulation.',
    rfm: { recency: [4, 30], frequency: [18, 46], monetaryWeight: [2.2, 5.5] },
    categoryAffinity: { 'Home Decor': 1.3, 'Gifts & Accessories': 1.25, 'Dining': 1.2, 'Personal Accessories': 1.15 },
  },
  {
    id: 2,
    key: 'value-seekers',
    name: 'Frequent Value Seekers',
    short: 'Value Seekers',
    color: '#0891B2',
    elasticityMultiplier: 1.4,
    unitShare: 0.32,
    customerShare: 0.28,
    description: 'Buy often with moderate baskets. Most responsive to price in this simulation.',
    rfm: { recency: [6, 45], frequency: [10, 28], monetaryWeight: [0.8, 1.8] },
    categoryAffinity: { 'Home & Kitchen': 1.3, 'Storage & Organization': 1.3, 'Stationery': 1.2, 'Drinkware': 1.1 },
  },
  {
    id: 3,
    key: 'occasional',
    name: 'Occasional Shoppers',
    short: 'Occasional',
    color: '#A855F7',
    elasticityMultiplier: 1.0,
    unitShare: 0.18,
    customerShare: 0.38,
    description: 'Infrequent purchases, often gift-led or seasonal. Moderate price response.',
    rfm: { recency: [30, 150], frequency: [3, 13], monetaryWeight: [0.35, 1.1] },
    categoryAffinity: { 'Seasonal Products': 1.5, 'Gifts & Accessories': 1.3, 'Drinkware': 1.1 },
  },
  {
    id: 4,
    key: 'at-risk',
    name: 'At-Risk Customers',
    short: 'At-Risk',
    color: '#EA580C',
    elasticityMultiplier: 1.2,
    unitShare: 0.12,
    customerShare: 0.22,
    description: 'Previously active but lapsing. Moderate-to-high price response.',
    rfm: { recency: [120, 365], frequency: [3, 14], monetaryWeight: [0.4, 1.3] },
    categoryAffinity: { 'Home & Kitchen': 1.15, 'Storage & Organization': 1.1, 'Stationery': 1.05 },
  },
];

export const BRANDS = [
  'Hearth & Co', 'Nordvale', 'Willow Lane', 'Paper Atelier', 'Brightside Home', 'Oak & Ember',
  'Studio Loom', 'Harbour Home', 'Kettleby', 'Fennwick', 'Marlow & Finch', 'Little Fern',
];

export const SUPPLIERS = [
  'Midlands Homeware Ltd', 'Northgate Trading', 'Avon Ceramics Supply', 'Thames Paper Co',
  'Pennine Imports', 'Solent Distribution', 'Cotswold Craft Wholesale', 'Humber Logistics Group',
];

/**
 * Category templates. Each item: [base name, subcategory, low price, high price].
 * seasonal: default seasonal profile for the category.
 */
export const CATEGORIES = [
  {
    name: 'Home & Kitchen',
    seasonal: { type: 'stable', amp: 0.08, peak: 48 },
    styles: ['Bamboo', 'Enamel', 'Stainless', 'Marble', 'Acacia', 'Copper-Tone', 'Classic'],
    items: [
      ['Chopping Board', 'Prep & Cooking', 9, 26], ['Utensil Set', 'Prep & Cooking', 8, 22],
      ['Mixing Bowl', 'Bakeware', 7, 20], ['Measuring Cups', 'Bakeware', 5, 12],
      ['Kitchen Scale', 'Prep & Cooking', 14, 32], ['Tea Towel Pack', 'Kitchen Textiles', 6, 14],
      ['Oven Gloves', 'Kitchen Textiles', 7, 15], ['Spice Rack', 'Prep & Cooking', 12, 30],
    ],
  },
  {
    name: 'Drinkware',
    seasonal: { type: 'stable', amp: 0.1, peak: 50 },
    styles: ['Speckled', 'Matte Black', 'Sage', 'Insulated', 'Glass', 'Hand-Glazed'],
    items: [
      ['Travel Tumbler', 'Travel', 11, 24], ['Latte Glass Set', 'Glassware', 9, 22],
      ['Espresso Cups', 'Mugs & Cups', 8, 18], ['Teacup & Saucer', 'Mugs & Cups', 7, 16],
      ['Cold Brew Jug', 'Glassware', 12, 26], ['Wine Tumblers', 'Glassware', 10, 24],
      ['Coffee Mug', 'Mugs & Cups', 6, 14],
    ],
  },
  {
    name: 'Home Decor',
    seasonal: { type: 'peak', amp: 0.25, peak: 47 },
    styles: ['Rattan', 'Ceramic', 'Brass', 'Linen', 'Terracotta', 'Woven', 'Oak'],
    items: [
      ['Photo Frame', 'Frames & Wall', 8, 24], ['Wall Mirror', 'Frames & Wall', 28, 60],
      ['Cushion Cover', 'Soft Furnishings', 9, 22], ['Throw Blanket', 'Soft Furnishings', 22, 48],
      ['Table Lamp', 'Lighting', 26, 58], ['Plant Pot', 'Planters', 7, 20],
      ['Candle Holder', 'Lighting', 8, 20], ['Decorative Bowl', 'Ornaments', 12, 30],
    ],
  },
  {
    name: 'Stationery',
    seasonal: { type: 'peak', amp: 0.35, peak: 36 },
    styles: ['Kraft', 'Recycled', 'Pastel', 'Linen-Bound', 'Minimal', 'Botanical'],
    items: [
      ['Weekly Planner', 'Planners', 9, 20], ['Dot Grid Notebook', 'Notebooks', 6, 15],
      ['Gel Pen Set', 'Writing', 4, 11], ['Desk Organiser', 'Desk Accessories', 11, 26],
      ['Greeting Card Pack', 'Cards', 4, 10], ['Washi Tape Set', 'Craft', 4, 9],
      ['Sticky Note Bundle', 'Desk Accessories', 3, 8],
    ],
  },
  {
    name: 'Gifts & Accessories',
    seasonal: { type: 'peak', amp: 0.45, peak: 50 },
    styles: ['Luxe', 'Vintage', 'Botanical', 'Monogram', 'Artisan', 'Classic'],
    items: [
      ['Gift Box', 'Gift Sets', 14, 34], ['Keyring', 'Small Gifts', 4, 10],
      ['Bath Gift Set', 'Pamper', 14, 32], ['Photo Album', 'Keepsakes', 14, 30],
      ['Bookmark Set', 'Small Gifts', 3, 8], ['Jewellery Dish', 'Keepsakes', 6, 15],
      ['Reed Diffuser', 'Fragrance', 12, 28],
    ],
  },
  {
    name: 'Storage & Organization',
    seasonal: { type: 'peak', amp: 0.2, peak: 3 },
    styles: ['Seagrass', 'Felt', 'Wire', 'Clear', 'Canvas', 'Stackable'],
    items: [
      ['Storage Basket', 'Baskets', 10, 28], ['Drawer Organiser', 'Drawer & Shelf', 7, 18],
      ['Laundry Hamper', 'Laundry', 18, 40], ['Shoe Rack', 'Hallway', 20, 45],
      ['Under-Bed Box', 'Boxes', 12, 26], ['Shelf Divider', 'Drawer & Shelf', 6, 14],
      ['Lidded Box Set', 'Boxes', 12, 30],
    ],
  },
  {
    name: 'Dining',
    seasonal: { type: 'peak', amp: 0.3, peak: 51 },
    styles: ['Stoneware', 'Porcelain', 'Reactive Glaze', 'Olive Wood', 'Hammered', 'Fine Bone'],
    items: [
      ['Dinner Plate Set', 'Tableware', 22, 48], ['Serving Platter', 'Serveware', 16, 36],
      ['Cutlery Set', 'Cutlery', 24, 55], ['Pasta Bowls', 'Tableware', 16, 34],
      ['Placemat Set', 'Table Linen', 10, 24], ['Salad Servers', 'Serveware', 9, 20],
      ['Napkin Set', 'Table Linen', 8, 18],
    ],
  },
  {
    name: 'Seasonal Products',
    seasonal: { type: 'peak', amp: 0.9, peak: 50 },
    styles: ['Nordic', 'Festive', 'Gingerbread', 'Woodland', 'Frosted', 'Heritage'],
    items: [
      ['Advent Calendar', 'Christmas', 12, 30], ['Bauble Set', 'Christmas', 8, 20],
      ['Wreath', 'Christmas', 18, 40], ['Stocking', 'Christmas', 8, 18],
      ['Garden Lantern', 'Summer', 14, 30], ['Picnic Blanket', 'Summer', 16, 34],
      ['Pumpkin Decoration', 'Autumn', 7, 18],
    ],
  },
  {
    name: 'Personal Accessories',
    seasonal: { type: 'stable', amp: 0.12, peak: 50 },
    styles: ['Leather', 'Canvas', 'Silk', 'Recycled', 'Quilted', 'Tortoiseshell'],
    items: [
      ['Card Holder', 'Wallets', 12, 28], ['Tote Bag', 'Bags', 12, 30],
      ['Hair Clip Set', 'Hair', 5, 12], ['Glasses Case', 'Cases', 7, 16],
      ['Wash Bag', 'Travel', 12, 26], ['Phone Pouch', 'Cases', 8, 18],
      ['Umbrella', 'Weather', 14, 30],
    ],
  },
];

/** Summer-peaking items inside the Seasonal category get a different profile. */
export const ITEM_SEASONAL_OVERRIDES = {
  'Garden Lantern': { type: 'peak', amp: 0.8, peak: 26 },
  'Picnic Blanket': { type: 'peak', amp: 0.8, peak: 28 },
  'Pumpkin Decoration': { type: 'peak', amp: 1.0, peak: 43 },
  'Umbrella': { type: 'peak', amp: 0.3, peak: 44 },
};

/**
 * Featured demo products with fixed attributes and a deliberate demand profile.
 * targetOptimumRatio is used by the generator to calibrate base price sensitivity;
 * the recommended price itself is ALWAYS computed by the optimizer.
 */
export const FEATURED_PRODUCTS = [
  {
    productName: 'Ceramic Coffee Mug', category: 'Drinkware', subcategory: 'Mugs & Cups',
    currentPrice: 10.0, unitCost: 6.0, baseWeeklyUnits: 125, inventory: 1850,
    seasonal: { type: 'stable', amp: 0, peak: 1 }, targetOptimumRatio: 1.2,
    segmentShares: [0.3, 0.28, 0.27, 0.15], trend: 0.06, brand: 'Hearth & Co', supplier: 'Avon Ceramics Supply',
    demoRole: 'Featured demo product',
  },
  {
    productName: 'Personalised Leather Notebook', category: 'Stationery', subcategory: 'Notebooks',
    currentPrice: 24.0, unitCost: 12.5, baseWeeklyUnits: 42, inventory: 900,
    seasonal: { type: 'peak', amp: 0.25, peak: 50 }, targetOptimumRatio: 1.32,
    segmentShares: [0.42, 0.16, 0.3, 0.12], trend: 0.12, brand: 'Paper Atelier', supplier: 'Thames Paper Co',
    demoRole: 'Benefits from a price increase',
  },
  {
    productName: 'Glass Storage Jar Set', category: 'Storage & Organization', subcategory: 'Boxes',
    currentPrice: 18.0, unitCost: 9.5, baseWeeklyUnits: 68, inventory: 2200,
    seasonal: { type: 'stable', amp: 0.08, peak: 3 }, targetOptimumRatio: 0.87,
    segmentShares: [0.18, 0.4, 0.22, 0.2], trend: -0.04, brand: 'Kettleby', supplier: 'Pennine Imports',
    demoRole: 'Benefits from a price decrease',
  },
  {
    productName: 'Linen Table Runner', category: 'Dining', subcategory: 'Table Linen',
    currentPrice: 16.0, unitCost: 9.0, baseWeeklyUnits: 55, inventory: 1400,
    seasonal: { type: 'peak', amp: 0.2, peak: 51 }, targetOptimumRatio: 1.0,
    segmentShares: [0.33, 0.24, 0.28, 0.15], trend: 0.02, brand: 'Studio Loom', supplier: 'Cotswold Craft Wholesale',
    demoRole: 'Already near optimal',
  },
  {
    productName: 'Scented Soy Candle Gift Set', category: 'Gifts & Accessories', subcategory: 'Fragrance',
    currentPrice: 22.0, unitCost: 11.0, baseWeeklyUnits: 88, inventory: 260,
    seasonal: { type: 'peak', amp: 0.35, peak: 50 }, targetOptimumRatio: 1.02,
    segmentShares: [0.36, 0.18, 0.34, 0.12], trend: 0.18, brand: 'Willow Lane', supplier: 'Solent Distribution',
    demoRole: 'Inventory constrained',
  },
  {
    productName: 'Stainless Steel Water Bottle', category: 'Drinkware', subcategory: 'Travel',
    currentPrice: 14.0, unitCost: 9.8, baseWeeklyUnits: 110, inventory: 2600,
    seasonal: { type: 'peak', amp: 0.3, peak: 27 }, targetOptimumRatio: 0.95,
    segmentShares: [0.14, 0.44, 0.24, 0.18], trend: 0.05, brand: 'Nordvale', supplier: 'Northgate Trading',
    demoRole: 'Highly price-sensitive',
  },
  {
    productName: 'Handmade Ceramic Vase', category: 'Home Decor', subcategory: 'Ornaments',
    currentPrice: 38.0, unitCost: 13.0, baseWeeklyUnits: 24, inventory: 520,
    seasonal: { type: 'peak', amp: 0.2, peak: 47 }, targetOptimumRatio: 1.12,
    segmentShares: [0.5, 0.1, 0.3, 0.1], trend: 0.08, brand: 'Oak & Ember', supplier: 'Avon Ceramics Supply',
    demoRole: 'Low price sensitivity',
  },
];

export const TARGET_PRODUCT_COUNT = 220;
export const CUSTOMER_COUNT = 3000;

export const OPPORTUNITY_RULES = {
  high: 5, // expected profit uplift % ≥ 5 → High Opportunity
  moderate: 2, // ≥ 2 → Moderate Opportunity (counted as a pricing opportunity); otherwise Near Optimal
};

export const APP_VERSION = 'v0.9.0-prototype';
