// Visibility is temporary UI state; passwords are never copied or persisted here.
(()=>{'use strict';
const hideAll=[];
for(const input of document.querySelectorAll('input[type="password"]')){
 const wrapper=document.createElement('div');wrapper.className='password-field';
 const button=document.createElement('button');button.type='button';button.className='password-toggle';
 if(input.id)button.setAttribute('aria-controls',input.id);
 function setVisible(visible){
  input.type=visible?'text':'password';
  button.textContent=visible?'🙊':'🙈';
  button.setAttribute('aria-label',visible?'Masquer le mot de passe':'Afficher le mot de passe');
  button.title=visible?'Masquer le mot de passe':'Afficher le mot de passe';
 }
 const hide=()=>setVisible(false);hideAll.push(hide);
 input.before(wrapper);wrapper.append(input,button);hide();
 button.addEventListener('click',()=>setVisible(input.type==='password'));
 input.form?.addEventListener('submit',hide,true);
 input.form?.addEventListener('reset',hide);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideAll.forEach(hide=>hide());});
window.addEventListener('pagehide',()=>hideAll.forEach(hide=>hide()));
})();
