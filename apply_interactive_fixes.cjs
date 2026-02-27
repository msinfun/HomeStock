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

    // Enhance Inputs, Textareas, Selects
    const inputRegex = /<(input|textarea|select)([^>]+)className=(["'])(.*?)\3/g;
    content = content.replace(inputRegex, (match, tag, beforeClass, quote, classStr) => {
        // Clean existing focus rings to standardize
        let cleanClass = classStr
            .replace(/focus:ring(-\d+)?(\/[0-9]+)?/g, '')
            .replace(/focus:ring-\[[^\]]+\](\/[0-9]+)?/g, '')
            .replace(/focus:border-\w+(-\d+)?/g, '')
            .replace(/focus:border-\[[^\]]+\]/g, '')
            .replace(/outline-none/g, '')
            .replace(/\s+/g, ' ').trim();

        // The user requested inputs to be rounded-full or rounded-[24px] inside. We'll default to rounded-full for inputs mostly, or preserve what they have (many already updated) 
        // actually user said "按鈕與標籤一律用 rounded-full" and "內部 textarea 的 rounded-[24px]" earlier but for now let's focus on rings

        const focusStyles = "focus:ring-4 focus:ring-[#007AFF]/15 focus:border-[#007AFF] outline-none";

        // Some checkboxes might not need this giant ring, let's ignore type="file" or type="checkbox"
        if (beforeClass.includes('type="file"') || beforeClass.includes('type="checkbox"')) {
            return match;
        }

        return `<${tag}${beforeClass}className=${quote}${cleanClass} ${focusStyles}${quote}`;
    });

    // Enhance Buttons
    const buttonRegex = /<button([^>]+)className=(["'])(.*?)\2/g;
    content = content.replace(buttonRegex, (match, beforeClass, quote, classStr) => {
        let cleanClass = classStr;

        // Add transiton-all and active:scale-95 if missing
        if (!cleanClass.includes('transition-all') && !cleanClass.includes('transition-colors') && !cleanClass.includes('transition-transform')) {
            cleanClass += ' transition-all';
        } else if (cleanClass.includes('transition-colors') || cleanClass.includes('transition-transform')) {
            // Upgrading to transition-all for better active scaling feel
            cleanClass = cleanClass.replace(/transition-colors|transition-transform/g, 'transition-all');
        }

        if (!cleanClass.includes('active:scale-') && !cleanClass.includes('active:translate')) {
            cleanClass += ' active:scale-95';
        }

        // Force rounded-full
        if (!cleanClass.includes('rounded-full')) {
            // Replace any other rounded-* 
            cleanClass = cleanClass.replace(/rounded-\[.*?\]/g, '').replace(/rounded-\w+/g, '').replace(/\s+/g, ' ').trim();
            cleanClass += ' rounded-full';
        }

        // Clean up spaces
        cleanClass = cleanClass.replace(/\s+/g, ' ').trim();

        return `<button${beforeClass}className=${quote}${cleanClass}${quote}`;
    });

    if (original !== content) {
        fs.writeFileSync(file, content, 'utf8');
        changedFilesCount++;
        console.log(`Updated ${file}`);
    }
});

console.log(`Complete. Changed ${changedFilesCount} files.`);
