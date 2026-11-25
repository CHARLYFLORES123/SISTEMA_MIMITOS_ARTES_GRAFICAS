const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '.next'].includes(f)) continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results = results.concat(walk(full));
      } else {
        results.push(full);
      }
    }
  } catch (e) {}
  return results;
}

const files = [...walk('artifacts'), ...walk('lib')];
console.log('Total files found:', files.length);

const terms = ['cierre', 'caja', 'adelanto', 'reserva'];
for (const file of files) {
  if (!file.match(/\.(ts|tsx|js|mjs)$/)) continue;
  const content = fs.readFileSync(file, 'utf8').toLowerCase();
  const matched = terms.filter(t => content.includes(t));
  if (matched.length > 0) {
    console.log(file, '-> matches:', matched.join(', '));
  }
}
