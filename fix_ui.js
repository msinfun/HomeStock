const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'components');
const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));

let changed = 0;

for (const file of files) {
    const filePath = path.join(componentsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // OUTER GLASS REPLACEMENTS
    // Replaces the heavy gradient + blur + shadow combo completely with the new Outer Glass Standard
    const rawGradientOuter = 'bg-gradient-to-br from-white/95 to-white/40 backdrop-blur-[40px] backdrop-saturate-150';
    const rawGradientOuter2 = 'bg-gradient-to-br from-white/80 to-white/40 backdrop-blur-[40px] backdrop-saturate-150';
    const outerGlassTarget = 'bg-white/80 backdrop-blur-xl'; // Outer container

    content = content.replace(new RegExp(rawGradientOuter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), outerGlassTarget);
    content = content.replace(new RegExp(rawGradientOuter2.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), outerGlassTarget);
    content = content.replace(/shadow-\[0_24px_48px_rgba\(0,0,0,0\.06\),inset_0_2px_2px_rgba\(255,255,255,1\)\]/g, 'shadow-[0_8px_32px_rgba(0,0,0,0.04)]');

    // MEAL PLANNER VIEW FIXES
    if (file === 'MealPlannerView.tsx') {
        // Inner Card Geometry Fix
        content = content.replace(/bg-white rounded-\[16px\] px-5 py-3\.5/g, 'bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] rounded-[24px] px-5 py-3.5');
        // Button geometry fix
        content = content.replace(/hover:bg-blue-50\/50 rounded-\[24px\] transition-all cursor-pointer group/g, 'hover:bg-blue-50/50 rounded-full transition-all cursor-pointer group');
        // Recommendation Card Fix
        content = content.replace(/bg-white p-3 rounded-2xl cursor-pointer/g, 'bg-white/90 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.03)] p-3 rounded-[24px] cursor-pointer');
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${file}`);
        changed++;
    }
}
console.log(`Total changed files: ${changed}`);
