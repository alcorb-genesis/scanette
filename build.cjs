const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, {recursive:true});
for (const file of ['index.html','core.js','interface.css','bellecave.html','bellecave.js']) {
  fs.copyFileSync(path.join(__dirname,file),path.join(output,file));
}
