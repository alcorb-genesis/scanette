(()=>{'use strict';
const routes={'index.html':'scan','gestion.html':'receipts','bellecave.html':'catalogue','gestion-demo.html':'demo'};
const file=location.pathname.split('/').pop()||'index.html';
const embedded=window.parent!==window&&new URLSearchParams(location.search).get('embedded')==='1';
if(embedded){
 const style=document.createElement('style');style.textContent='header nav,.intro-panel .workspace-nav,#logoutBtn{display:none!important}';document.head.append(style);
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;const u=new URL(a.href,location.href),target=u.pathname.split('/').pop()||'index.html';if(u.origin!==location.origin||!routes[target])return;e.preventDefault();window.parent.postMessage({type:'alcorb-section',section:routes[target]},location.origin);});
 return;
}
if(file!=='gestion-demo.html'){location.replace('application.html#'+(file==='index.html'?'home':routes[file]||'home'));return;}
const nav=document.createElement('nav');nav.setAttribute('aria-label','Accès au magasin');nav.style.cssText='padding:10px 16px;background:#102132;font:15px system-ui';const a=document.createElement('a');a.href='application.html';a.textContent='Ouvrir mon espace privé';a.style.cssText='display:inline-flex;align-items:center;min-height:44px;color:#bcfff0';nav.append(a);document.body.prepend(nav);
})();
