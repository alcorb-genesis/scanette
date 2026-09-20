const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, {recursive:true});
for (const file of ['index.html','core.js','interface.css','bellecave.html','bellecave.js','warehouse.js','palette-worker.js','sweep-tracker.js','sweep.js','gestion.html','gestion.css','gestion.js','gestion-core.js','gestion-bridge.js','gestion-demo.html','gestion-demo.js']) {
  fs.copyFileSync(path.join(__dirname,file),path.join(output,file));
}
