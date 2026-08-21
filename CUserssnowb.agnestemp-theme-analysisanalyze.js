const fs = require('fs');
const path = require('path');
const sourceDir = 'C:\Users\snowb\.agnes\codex-themes-downloaded';
const themes = ['github-noir', 'ink-blossom', 'sweet-strawberry-code'];
for (const t of themes) {
    const filePath = path.join(sourceDir, t + '.zip');
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(content);
        const css = json.css || '';
        const lines = css.split('\n');
        const selectors = lines.filter(l => l.trim().startsWith('.') || l.trim().startsWith('#') || l.trim().startsWith('[') || l.trim().startsWith(':'));
        console.log('=== ' + t + ' ===');
        console.log('CSS length:', css.length, '| Lines:', lines.length);
        console.log('var() usages:', (css.match(/var\(--/g) || []).length);
        console.log('Has blur/backdrop:', css.includes('backdrop-filter') || css.includes('blur('));
        console.log('Has gradients:', css.includes('linear-gradient') || css.includes('radial-gradient'));
        console.log('Has animations:', css.includes('@keyframes') || css.includes('animation:'));
        console.log('data-codexthemes:', [...new Set(css.match(/data-codexthemes[^]]*]/g) || [])].slice(0, 6));
        // Sample selectors
        console.log('Sample selectors:');
        selectors.slice(0, 6).forEach(s => console.log('  ' + s.trim().substring(0, 80)));
        console.log('');
    } catch(e) {
        console.log('Error:', e.message.substring(0, 200));
    }
}
