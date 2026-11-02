import { el, button, field, option } from './dom.js';
import { apiFetch } from '../core/api.js';

export function createGallery({api,dialogs,getCurrent,localAction,illustrate}) {
  let serial=0;
  function live(token,id){return serial===token&&getCurrent()?.id===id;}
  function render(story,root){
    const token=++serial;root.replaceChildren(el('p','Opening retained image collection…'));
    const controls=el('div','','workspace-actions');
    controls.append(button('Upload to collection',()=>upload(story)),button('Paint a target',()=>illustrate()));
    const grid=el('div','','fiction-image-grid');const message=el('p');message.setAttribute('role','status');
    root.replaceChildren(controls,el('p','Removing an image from a path keeps it here. Private reference pictures stay outside exported books.'),grid,message);
    let offset=0;let inventory;
    const load=async()=>{try{
      const params=new URLSearchParams({offset:String(offset)});if(inventory!==undefined)params.set('inventory_revision',inventory);
      const data=await api(`/fiction/${story.id}/assets?${params}`);if(!live(token,story.id))return;
      inventory=data.inventory_revision;
      for(const image of data.assets){const card=el('article','','fiction-card');const img=el('img');img.src=image.thumbnail_url;img.alt=image.alt_text||image.placements[0]?.alt_text||'Retained story image';img.loading='lazy';
        card.append(img,el('h3',image.alt_text||image.placements[0]?.alt_text||'Story image'),el('p',image.placements.length?'Used on the current path':'Retained; not placed on this path'),button('Preview and place',()=>preview(story,image)));grid.append(card);}
      if(!grid.children.length)message.textContent='No retained images yet. Upload or paint an image to begin.';
      more.remove();if(data.next_offset!==null){offset=data.next_offset;root.append(more);}
    }catch(error){if(live(token,story.id))message.textContent=error.message;}};
    const more=button('More retained images',load);load();
  }
  function upload(story){
    const alt=field('Image description','textarea','',{maxLength:1000});
    const file=field('Image file (up to 20 MB)','input','',{type:'file',accept:'image/png,image/jpeg,image/webp,image/gif,image/avif'});
    const status=el('p');status.setAttribute('role','status');
    dialogs.openDialog({title:'Upload to this story’s collection',body:[el('p','This keeps an unplaced image. Choose its path and target after upload. File selections cannot be restored after reload; your local original is unchanged.'),alt.wrapper,file.wrapper,status],actions:[{label:'Cancel',className:'btn-secondary',onClick:close=>close(true)},{label:'Upload image',className:'btn-primary',onClick:async close=>{
      if(!alt.control.value.trim()||!file.control.files?.[0]){status.textContent='Describe the image and choose a file.';return;}
      const form=new FormData();form.append('alt_text',alt.control.value.trim());form.append('image',file.control.files[0]);
      try{const response=await apiFetch(`/api/fiction/${story.id}/assets/upload`,{method:'POST',body:form});const body=await response.json();if(!response.ok)throw Error(body.error||'Upload failed.');close(true);if(getCurrent()?.id===story.id)render(getCurrent(),document.getElementById('workspaceImages'));}catch(error){status.textContent=error.message+' Your description is still here.';}
    }}]});
  }
  async function preview(story,image){
    const body=el('div');const img=el('img');img.src=image.image_url;img.alt=image.alt_text||'Story image';img.className='gallery-preview';
    const status=el('p');status.setAttribute('role','status');body.append(img,status);
    const target=field('Place on current path','select');target.control.append(option('cover','Book cover'));
    for(const kind of ['world','scribe'])if(story.state.library?.[kind])target.control.append(option(kind,`${kind} reference (private)`));
    for(const person of story.state.cast)target.control.append(option(`character:${person.id}`,`${person.name} portrait (private)`));
    const alt=field('Placement description','textarea',image.alt_text||image.placements[0]?.alt_text||'',{maxLength:1000});
    const search=field('Find a passage on the current path','input','',{maxLength:200});
    const passages=el('div');let searchSerial=0;let selectedPassage=null;
    const load=async()=>{const at=++searchSerial;try{const params=new URLSearchParams({branch_id:story.active_branch_id,inspection_at:story.head_beat_id||'initial',q:search.control.value});const data=await api(`/fiction/${story.id}/assets/targets?${params}`);if(at!==searchSerial)return;passages.replaceChildren();for(const beat of data.targets||[]){passages.append(button(beat.excerpt,()=>{selectedPassage=beat.id;target.control.value='passage';status.textContent='Selected passage: '+(beat.excerpt);}));}}catch(error){if(at===searchSerial)status.textContent=error.message;}};
    target.control.append(option('passage','Selected passage'));search.control.addEventListener('change',load);
    body.append(target.wrapper,alt.wrapper,search.wrapper,button('Find passages',load),passages,el('p','Reader: above the passage. EPUB: a separate image page immediately before its text. Replacing a placement keeps the previous image in the collection.'));
    dialogs.openDialog({title:'Retained image',body:[body],actions:[{label:'Keep unplaced / Close',className:'btn-secondary',onClick:close=>close(true)},{label:'Place on current path',className:'btn-primary',onClick:async close=>{
      const current=getCurrent();if(!current||current.id!==story.id||current.revision!==story.revision||current.active_branch_id!==story.active_branch_id){status.textContent='The path changed. Reopen this preview before placing the image.';return;}
      const choice=target.control.value;const input={alt_text:alt.control.value.trim()};if(choice==='passage'){if(!selectedPassage){status.textContent='Find and select a passage first.';return;}input.beat_id=selectedPassage;}else{const [kind,subject_id]=choice.split(':');Object.assign(input,{kind,subject_id:subject_id||null});}
      const result=await localAction(`assets/${image.id}/place`,'POST',{input});if(result?.ok)close(true);else status.textContent=result?.error||'Not placed. The image remains in the collection.';
    }}]});
    try{const detail=await api(`/fiction/${story.id}/assets/${image.id}`);if(body.isConnected&&getCurrent()?.id===story.id)status.textContent=`${image.provenance} · ${detail.retained_uses.length}${detail.has_more_uses?'+':''} retained historical uses. ${detail.placements.length?'Currently placed.':'Image ready; not placed.'}`;}catch(error){if(body.isConnected&&getCurrent()?.id===story.id)status.textContent=error.message;}
  }
  return {render,clear(){serial++;}};
}
