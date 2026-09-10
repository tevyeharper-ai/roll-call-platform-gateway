(() => {
  let stage='explore';
  const stageButtons=[...document.querySelectorAll('[data-stage]')];
  const inspectorStage=document.getElementById('inspectorStage');
  const codePreview=document.getElementById('codePreview');
  const conversation=document.getElementById('conversation');
  const target=document.getElementById('targetCard');
  const desc=document.getElementById('previewDescription');
  const prompt=document.getElementById('prompt');

  function setStage(next){
    stage=next;
    stageButtons.forEach(b=>b.classList.toggle('active',b.dataset.stage===stage));
    if(inspectorStage) inspectorStage.value=stage.charAt(0).toUpperCase()+stage.slice(1);
    if(codePreview){
      const mutation=stage==='build'?'allowed in preview branch':'blocked';
      codePreview.textContent=`// Forge Developer Mode\n// Builder and Developer Mode operate on the same application.\n\nexport const EventCard = ({ event }) => {\n  return <article data-forge-component="EventCard">\n    {/* governed component implementation */}\n  </article>;\n};\n\n// Current AI stage: ${stage.charAt(0).toUpperCase()+stage.slice(1)}\n// Source mutation: ${mutation}\n// Tenant context: required\n// Design dossier: required\n`;
    }
  }
  stageButtons.forEach(btn=>btn.addEventListener('click',()=>setStage(btn.dataset.stage)));
  document.querySelectorAll('[data-prompt-chip]').forEach(btn=>btn.addEventListener('click',()=>{if(prompt)prompt.value=btn.dataset.promptChip;}));

  document.querySelectorAll('[data-device]').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-device]').forEach(b=>b.classList.remove('selected'));btn.classList.add('selected');
    const p=document.getElementById('preview');if(p)p.className='preview '+btn.dataset.device;
  }));

  function addMessage(text,kind='ai'){
    if(!conversation)return;const div=document.createElement('div');div.className='message '+kind;
    div.innerHTML=kind==='ai'?'<strong>Avery</strong>'+text:text;conversation.appendChild(div);conversation.scrollTop=conversation.scrollHeight;
  }
  const send=document.getElementById('sendPrompt');
  if(send)send.addEventListener('click',()=>{
    if(!prompt||!prompt.value.trim())return;const text=prompt.value.trim();addMessage(text,'user');prompt.value='';
    if(stage==='explore'){
      addMessage('I’m treating this as exploration only. I’ll clarify the experience, identify affected surfaces and suggest options without changing the application.');
    }else if(stage==='research'){
      addMessage('<div class="system-note">Research mode keeps source code unchanged. Forge would gather approved external references plus current client context, then attach findings to the Build Brief.</div>');
      if(target){target.classList.remove('designed','built');target.classList.add('researched');}if(desc)desc.textContent='Research findings are being evaluated against the current Design Dossier. No source mutation.';
    }else if(stage==='design'){
      addMessage('<div class="build-plan"><b>Proposed design direction</b><ul><li>Increase visual hierarchy</li><li>Reduce metadata noise</li><li>Preserve EventCard contract</li><li>Preview before build approval</li></ul></div>');
      if(target){target.classList.remove('researched','built');target.classList.add('designed');}if(desc)desc.textContent='Design proposal applied to the preview concept only. The underlying source remains unchanged.';
    }else{
      addMessage('Build stage is approved for the preview workspace. Forge is applying the proposed change to the development preview only, then it must be tested and certified before release.');
      if(target){target.classList.add('building');setTimeout(()=>{target.classList.remove('building','researched','designed');target.classList.add('built');if(desc)desc.textContent='Preview branch updated from your prompt. Production remains untouched.';},650);}
    }
  });
})();
