const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'public');
// The publication directory is a build artifact. Clear it first so a retired screen cannot remain online from an older build.
fs.rmSync(output, {recursive:true, force:true});
fs.mkdirSync(output, {recursive:true});
for (const file of ['returns.html','returns.css','returns.js','returns-core.js','preparation-live.js','preparation-ocr-core.js','preparation-photo.js','preparation.html','preparation.css','preparation-core.js','preparation.js','catalogue-evidence.js','garage-records.js','scan-suppliers.js','location-search.js','receipt-link-core.js','receipt-link.js','shared-access.js','camera-controls.js','logistics-sessions.html','logistics-sessions.js','logistics-core.js','store-partners.html','store-partners.js','partner-planning-core.js','application.js','application.css','workspaces.js','workspaces.css','suppliers-official-data.json','reference.css','reference-core.js','reference-ui.js','partners-osm-data.json','products-open-data.json','gestion-shell.css','application.html','application-nav.js','partenaires.html','partenaires.css','partenaires.js','partners-data.json','index.html','core.js','scan-input-core.js','ui-base.css','nav-history.js','nav-layers.js','interface.css','bellecave.html','bellecave.js','warehouse.js','palette-worker.js','sweep-tracker.js','sweep.js']) {
  fs.copyFileSync(path.join(__dirname,file),path.join(output,file));
}
for (const file of ['returns-portal.html','returns-portal.css','returns-portal.js','returns-portal-core.js']) fs.copyFileSync(path.join(__dirname,file),path.join(output,file));


// Retired screens remain in source history, but are not served as active modules.
// Team and store settings are account administration: never served under the shared logistics access.
const retired = ['delivery-tracking.html', 'store-purchases.html', 'store-sales.html', 'gestion.html', 'gestion-demo.html', 'scenario.html', 'team.html', 'store-settings.html'];
const redirect = '<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=application.html#home"><title>Alcorb Logistique</title><a href="application.html#home">Revenir à la logistique</a></html>';
for (const file of retired) fs.writeFileSync(path.join(output,file),redirect);
for (const file of ['delivery-tracking.js','delivery-tracking.css','delivery-position.js','store-purchases.js', 'store-sales.js', 'sales-core.js', 'delivery-tours-core.js', 'delivery-tours-ui.js', 'delivery-tours.css', 'delivery-print.js', 'delivery-print.css', 'scenario.css', 'scenario.js', 'scenario-core.js', 'gestion.css', 'gestion.js', 'gestion-core.js', 'gestion-bridge.js', 'gestion-demo.js', 'team.js', 'store-settings.js', 'pin-ui.js', 'delivery-garages.js', 'password-visibility.js', 'password-visibility.css']) { const target=path.join(output,file); if(fs.existsSync(target)) fs.unlinkSync(target); }

// The logistics PIN is retired (shared access without account): pin-ui.js is no longer published.

fs.mkdirSync(path.join(output,'inventory'),{recursive:true});
for(const file of ['index.html','prepare.html','core.js','storage.js','app.js','prepare.js','style.css','sw.js','html5-qrcode.min.js','LICENSE.html5-qrcode']) fs.copyFileSync(path.join(__dirname,'inventory',file),path.join(output,'inventory',file));
