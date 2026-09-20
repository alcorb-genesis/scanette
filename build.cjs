const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, {recursive:true});
for (const file of ['team.html','team.js','store-settings.html','store-settings.js','application.js','application.css','workspaces.js','workspaces.css','suppliers-official-data.json','reference.css','reference-core.js','reference-ui.js','partners-osm-data.json','products-open-data.json','scenario.html','scenario.css','scenario.js','scenario-core.js','gestion-shell.css','application.html','application-nav.js','partenaires.html','partenaires.css','partenaires.js','partners-data.json','index.html','core.js','interface.css','bellecave.html','bellecave.js','warehouse.js','palette-worker.js','sweep-tracker.js','sweep.js','gestion.html','gestion.css','gestion.js','gestion-core.js','gestion-bridge.js','gestion-demo.html','gestion-demo.js']) {
  fs.copyFileSync(path.join(__dirname,file),path.join(output,file));
}

