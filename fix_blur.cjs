const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'components');
const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));

for (const file of files) {
    const filePath = path.join(componentsDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');
    let original = content;

    // 1. Upgrade backdrop-blur-md -> backdrop-blur-[40px] (add saturate if missing)
    // Simple cases: just swap the blur class
    content = content.replace(/backdrop-blur-md(?!\s*backdrop-saturate)/g, 'backdrop-blur-[40px] backdrop-saturate-150');
    // If already had saturate, just swap blur
    content = content.replace(/backdrop-blur-md(\s+backdrop-saturate-\w+)/g, 'backdrop-blur-[40px]$1');

    // 2. Upgrade backdrop-blur-2xl -> backdrop-blur-[40px]
    content = content.replace(/backdrop-blur-2xl(?!\s*backdrop-saturate)/g, 'backdrop-blur-[40px] backdrop-saturate-150');
    content = content.replace(/backdrop-blur-2xl(\s+backdrop-saturate-\w+)/g, 'backdrop-blur-[40px]$1');

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Updated ${file}`);
    }
}
