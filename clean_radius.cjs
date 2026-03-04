const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'components');
const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
    const filePath = path.join(componentsDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    let original = content;

    // 1. Upgrade 24px systematically
    content = content.replace(/rounded-\[24px\]/g, 'rounded-3xl');

    // 2. RecipeView.tsx
    if (file === 'RecipeView.tsx') {
        content = content.replace(/rounded-\[16px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[28px\]/g, 'rounded-2xl');
    }
    // 3. Dashboard.tsx
    else if (file === 'Dashboard.tsx') {
        content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[16px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[28px\]/g, 'rounded-3xl');
    }
    // 4. MealPlannerView.tsx
    else if (file === 'MealPlannerView.tsx') {
        content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[16px\]/g, 'rounded-2xl');
    }
    // 5. ShoppingListView.tsx
    else if (file === 'ShoppingListView.tsx') {
        content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
    }
    // 6. AddRecipeView.tsx & AddItemView.tsx & others
    else {
        content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[16px\]/g, 'rounded-2xl');
        content = content.replace(/rounded-\[28px\]/g, 'rounded-3xl');
    }

    // Double check catch all
    content = content.replace(/rounded-\[16px\]/g, 'rounded-2xl');
    content = content.replace(/rounded-\[20px\]/g, 'rounded-2xl');
    content = content.replace(/rounded-\[24px\]/g, 'rounded-3xl');
    content = content.replace(/rounded-\[28px\]/g, 'rounded-3xl');

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Updated ${file}`);
    }
}
