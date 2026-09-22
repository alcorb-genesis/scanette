const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
fs.mkdirSync(output, {recursive:true});
for (const file of ['delivery-tracking.html','delivery-tracking.js','delivery-tracking.css','password-visibility.js','password-visibility.css','camera-controls.js','logistics-sessions.html','logistics-sessions.js','logistics-core.js','store-partners.html','store-partners.js','partner-planning-core.js','team.html','team.js','store-settings.html','store-settings.js','application.js','application.css','workspaces.js','workspaces.css','suppliers-official-data.json','reference.css','reference-core.js','reference-ui.js','partners-osm-data.json','products-open-data.json','gestion-shell.css','application.html','application-nav.js','partenaires.html','partenaires.css','partenaires.js','partners-data.json','index.html','core.js','interface.css','bellecave.html','bellecave.js','warehouse.js','palette-worker.js','sweep-tracker.js','sweep.js']) {
  fs.copyFileSync(path.join(__dirname,file),path.join(output,file));
}


// Retired screens remain in source history, but are not served as active modules.
const retired = ['store-purchases.html', 'store-sales.html', 'gestion.html', 'gestion-demo.html', 'scenario.html'];
const redirect = '<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=application.html#home"><title>Alcorb Logistique</title><a href="application.html#home">Revenir à la logistique</a></html>';
for (const file of retired) fs.writeFileSync(path.join(output,file),redirect);
for (const file of ['store-purchases.js', 'store-sales.js', 'sales-core.js', 'delivery-tours-core.js', 'delivery-tours-ui.js', 'delivery-tours.css', 'delivery-print.js', 'delivery-print.css', 'scenario.css', 'scenario.js', 'scenario-core.js', 'gestion.css', 'gestion.js', 'gestion-core.js', 'gestion-bridge.js', 'gestion-demo.js']) { const target=path.join(output,file); if(fs.existsSync(target)) fs.unlinkSync(target); }

// Retired PIN client must not remain in a reused output directory.
const retiredPin=path.join(output,'pin-ui.js');
if(fs.existsSync(retiredPin)) fs.unlinkSync(retiredPin);

fs.mkdirSync(path.join(output,'inventory'),{recursive:true});
for(const file of ['index.html','prepare.html','core.js','storage.js','app.js','prepare.js','style.css','sw.js','html5-qrcode.min.js','LICENSE.html5-qrcode']) fs.copyFileSync(path.join(__dirname,'inventory',file),path.join(output,'inventory',file));
