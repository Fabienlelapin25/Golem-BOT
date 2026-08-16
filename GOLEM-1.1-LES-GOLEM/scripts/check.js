const { execFileSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const { join } = require('path');
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.includes('node_modules')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) execFileSync(process.execPath, ['--check', p], {stdio:'inherit'});
  }
}
walk(process.cwd());
console.log('✅ Syntaxe JavaScript valide');
