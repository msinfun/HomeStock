
// ... existing interfaces ...
export interface InventoryDef {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  defaultLocation: string;
  minThreshold: number;
  image?: string;
  createdDate: string;
  review?: string;
  openedDate?: string;
  packageSize?: string; // Renamed concept from remarks for specs (e.g., "500ml")
  price?: number;
  remarks?: string; // 🍎 補上這一行
}

export interface InventoryTransaction {
  id: string;
  defId: string;
  type: 'init' | 'restock' | 'consume' | 'adjust' | 'edit' | 'scrap';
  delta: number;
  timestamp: string;
  expiryDate?: string;
  openedDate?: string;
  remarks?: string;
}

export interface InventoryBatch {
  expiryDate: string | '無效期';
  quantity: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  category: string;
  subCategory?: string;
  location: string;
  openedDate?: string;
  expiryDate?: string;
  remarks?: string; // General notes
  packageSize?: string; // New: Specs/Size
  price?: number; // New: Price
  lastUsedDate?: string;
  lastPurchasedDate?: string;
  nextRestockDate?: string | null;
  minThreshold: number;
  batches: InventoryBatch[];
  review?: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  category: string;
  addedDate: string;
  isChecked?: boolean;
}

// --- New Recipe Interfaces ---
export interface Recipe {
  id: string;
  name: string;
  servings?: number; // 幾人份
  ingredients: string[];
  steps: string;
  tags: string[]; // Merged tags (cuisine, dishType, attributes)
  createdDate: string;
  sourceLink?: string; // New: Store the original URL (YouTube/Blog)
  review?: string; // New: Cooking review/notes
}

export interface DailyMeals {
  breakfast: string[];
  lunch: string[];
  dinner: string[];
}

export type MealPlan = Record<string, DailyMeals>;

// New: Hierarchical Tag Structure
export type RecipeTagStructure = Record<string, string[]>;

export interface AppSettings {
  expiryThresholdDays: number;
}

// --- Backup Interface ---
export interface SystemBackup {
  version: string;
  timestamp: string;
  data: {
    defs: InventoryDef[];
    transactions: InventoryTransaction[];
    recipes: Recipe[];
    shoppingList: ShoppingItem[];
    settings: AppSettings;
    categories: string[];
    locations: string[];
    recipeTags?: RecipeTagStructure; // Added to backup
    mealPlans?: MealPlan; // Added to backup
  };
}

export type ViewState = 'dashboard' | 'inventory' | 'shopping' | 'recipes' | 'add-recipe' | 'edit-recipe' | 'add' | 'edit' | 'settings' | 'analysis' | 'meal-planner';
