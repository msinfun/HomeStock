const fs = require('fs');
const path = require('path');

const walk = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.tsx') && !file.includes('node_modules')) {
                results.push(file);
            }
        }
    });
    return results;
};

const files = walk('./components');
files.push('./App.tsx');

let changedFilesCount = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    // 1. Colors
    content = content.replace(/text-rose-500/g, 'text-[#FF3B30]');
    content = content.replace(/bg-rose-50/g, 'bg-red-50');
    content = content.replace(/text-emerald-500/g, 'text-[#34C759]');
    content = content.replace(/bg-emerald-50/g, 'bg-green-50');

    // 2. Rounded corners
    content = content.replace(/rounded-2xl/g, 'rounded-[24px]');

    // 3. Background materials
    content = content.replace(/bg-white\/30/g, 'bg-white/80');
    content = content.replace(/bg-white\/50/g, 'bg-white/80');
    content = content.replace(/bg-white\/60/g, 'bg-white/90');
    content = content.replace(/bg-white\/95/g, 'bg-white/90');

    // 4. Glassmorphism blur & saturate
    content = content.replace(/backdrop-blur-(sm|md|lg|xl|2xl)/g, 'backdrop-blur-[40px] backdrop-saturate-150');
    // Dedup backdrop-saturate-150 with a more robust regex
    content = content.replace(/(backdrop-saturate-150\s*){2,}/g, 'backdrop-saturate-150 ');

    // Dedup backdrop-blur-[40px] just in case
    content = content.replace(/(backdrop-blur-\[40px\]\s*){2,}/g, 'backdrop-blur-[40px] ');

    // Border opacity standardization
    content = content.replace(/border-white\/(10|30|40|50|80)/g, 'border-white/60');

    // 5. Shadows
    content = content.replace(/shadow-(sm|md|inner)/g, 'shadow-[0_2px_10px_rgba(0,0,0,0.03)]');

    // Any big shadow regex replacement (targeting cards/modals mostly)
    content = content.replace(/shadow-\[[^\]]*(20|24|30|32|40|48)px[^\]]*\]/g, 'shadow-[0_24px_48px_rgba(0,0,0,0.06),inset_0_2px_2px_rgba(255,255,255,1)]');

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        changedFilesCount++;
        console.log(`Updated ${file}`);
    }
});

console.log(`\nComplete. Changed ${changedFilesCount} files.`);
