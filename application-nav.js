(()=>{'use strict';
const routes={'store-partners.html':'departures','team.html':'team','store-settings.html':'settings','index.html':'scan','bellecave.html':'catalogue','gestion.html':'home','gestion-demo.html':'home','store-sales.html':'home','store-purchases.html':'home','scenario.html':'home'};
const file=location.pathname.split('/').pop()||'index.html';
const embedded=window.parent!==window&&new URLSearchParams(location.search).get('embedded')==='1';
if(embedded){
 const style=document.createElement('style');style.textContent='header nav,.intro-panel .workspace-nav,#logoutBtn{display:none!important}';document.head.append(style);
 document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;const u=new URL(a.href,location.href),target=u.pathname.split('/').pop()||'index.html';if(u.origin!==location.origin||!routes[target])return;e.preventDefault();window.parent.postMessage({type:'alcorb-section',section:routes[target]},location.origin);});
 return;
}
location.replace('application.html#'+(file==='index.html'?'home':routes[file]||'home'));
})();
