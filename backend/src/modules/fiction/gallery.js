'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp');
const { normalizeImage, normalizeImageFile } = require('../imagery/art-store');
const { receiveImageUpload } = require('../imagery/upload');
const { keys, text, fail } = require('./model');
const { imagePrompt } = require('./library-model');
const hash = value => createHash('sha256').update(value).digest('hex');

function createGallery({ db, store, media, queries, providers, generateIllustration }) {
  const router = express.Router();
  const base='/api/fiction/:id/assets';
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const version=id=>db.prepare('SELECT revision FROM fiction_inventory_versions WHERE game_id=?').get(id)?.revision;
  function capacity(id) {store.current(id);if(db.prepare('SELECT count(*) AS n FROM fiction_assets WHERE game_id=?').get(id).n>=400)fail('This story has reached its 400-image save limit.','IMAGE_LIMIT',413);}
  function insert(id,asset,alt,provenance){
    capacity(id);
    db.prepare('INSERT INTO fiction_assets(id,game_id,media_type,sha256,byte_size,width,height,storage_key) VALUES(?,?,?,?,?,?,?,?)').run(asset.id,id,asset.media_type,asset.sha256,asset.byte_size,asset.width,asset.height,asset.storage_key);
    db.prepare('UPDATE fiction_inventory SET alt_text=?,provenance=? WHERE asset_id=?').run(alt,provenance,asset.id);
  }
  function find(id,assetId){return db.prepare('SELECT a.*,i.alt_text,i.provenance,i.created_at FROM fiction_assets a JOIN fiction_inventory i ON i.asset_id=a.id WHERE a.game_id=? AND a.id=?').get(id,assetId)||fail('Image not found.','IMAGE_NOT_FOUND',404);}
  function uses(state,asset){return [...(state.visuals||[]),...(state.illustrations||[])].filter(item=>item.asset_id===asset).map(item=>({kind:item.kind||'passage',subject_id:item.subject_id||null,beat_id:item.beat_id||null,alt_text:item.alt_text,caption:item.caption||''}));}
  function list(id,query={}){
    const ctx=queries.context(id,query);const offset=Number(query.offset||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>400)fail('Invalid image page.');
    const revision=version(id);if(query.inventory_revision!==undefined&&String(revision)!==String(query.inventory_revision))fail('The image collection changed. Refresh the collection.','INVENTORY_CHANGED',409);
    const rows=db.prepare('SELECT a.id,a.width,a.height,a.byte_size,a.sha256,i.alt_text,i.provenance,i.created_at FROM fiction_assets a JOIN fiction_inventory i ON i.asset_id=a.id WHERE a.game_id=? ORDER BY a.rowid LIMIT 41 OFFSET ?').all(id,offset);
    return {...queries.metadata(ctx),inventory_revision:revision,assets:rows.slice(0,40).map(asset=>({...asset,placements:uses(ctx.state,asset.id),thumbnail_url:`/api/fiction/${id}/assets/${asset.id}/thumbnail`,image_url:`/api/fiction/${id}/images/${asset.id}`})),next_offset:rows.length>40?offset+40:null};
  }
  function detail(id,assetId,query={}){
    const ctx=queries.context(id,query);const asset=find(id,assetId);
    // Bounded use metadata: SQLite extracts only matching placements, never serializes private states.
    const historical=db.prepare(`SELECT b.id AS moment_id,b.branch_id,json_extract(j.value,'$.beat_id') AS passage_id,json_extract(j.value,'$.kind') AS kind FROM fiction_beats b,json_each(b.state_json,'$.illustrations') j WHERE b.game_id=? AND json_extract(j.value,'$.asset_id')=? UNION ALL SELECT b.id,b.branch_id,NULL,json_extract(j.value,'$.kind') FROM fiction_beats b,json_each(b.state_json,'$.visuals') j WHERE b.game_id=? AND json_extract(j.value,'$.asset_id')=? LIMIT 81`).all(id,assetId,id,assetId);
    const metadata={...asset};delete metadata.storage_key;
    return {asset:metadata,placements:uses(ctx.state,assetId),retained_uses:historical.slice(0,80),has_more_uses:historical.length>80,inventory_revision:version(id)};
  }
  function target(id,input){
    if(input.kind&&input.beat_id!==undefined)fail('Choose one image target.');
    if(input.kind)return store.referenceTarget(id,input.kind,input.subject_id??null);
    if(input.beat_id)return store.illustrationTarget(id,input.beat_id);
    fail('Choose a passage or reference target for painting.');
  }
  function attach(id,expected,asset,input){
    keys(input,['beat_id','kind','subject_id','alt_text','caption'],'Image placement');
    target(id,input);
    return input.kind?store.visualize(id,expected,{...input,asset}):store.illustrate(id,expected,{...input,asset});
  }
  async function upload(id,file,alt){
    capacity(id);alt=text(alt,'Image description',1000);
    const normalized=await normalizeImageFile(file.path,file.mediaType);let asset;
    try{asset=media.persist(normalized);tx(()=>insert(id,asset,alt,'upload'));return {asset_id:asset.id,inventory_revision:version(id),placed:false};}
    catch(error){if(asset&&!db.prepare('SELECT id FROM fiction_assets WHERE id=?').get(asset.id))media.discard(asset);throw error;}
  }
  const jobView=row=>({id:row.id,status:row.status,asset_id:row.asset_id,placed:Boolean(row.placed),billed_attempts:row.billed_attempts,cost_usd:row.cost_usd,error_code:row.error_code});
  function status(id,key){store.current(id);const row=db.prepare('SELECT * FROM fiction_art_jobs WHERE game_id=? AND action_key=?').get(id,key);return row?jobView(row):{status:'unregistered',can_start_new:false};}
  function cancel(id,key){return tx(()=>{store.current(id);const row=db.prepare('SELECT * FROM fiction_art_jobs WHERE game_id=? AND action_key=?').get(id,key);if(!row){db.prepare("INSERT INTO fiction_art_jobs(id,game_id,action_key,fingerprint,branch_id,expected_revision,status) VALUES(?,?,?,'cancelled',?,0,'cancelled')").run(randomUUID(),id,key,store.current(id).branch.id);}else if(row.status==='running')db.prepare("UPDATE fiction_art_jobs SET status='cancelled' WHERE id=?").run(row.id);return status(id,key);});}
  async function paint(id,body){
    keys(body,['expected_revision','idempotency_key','input','place'],'Gallery painting');
    const input=body.input;keys(input,['beat_id','kind','subject_id','direction','alt_text','caption','aspect_ratio','provider_id','model'],'Gallery painting');
    const key=text(body.idempotency_key,'Action key',200);const fingerprint=hash(JSON.stringify(body));
    const existing=db.prepare('SELECT * FROM fiction_art_jobs WHERE game_id=? AND action_key=?').get(id,key);
    if(existing){if(existing.fingerprint!==fingerprint)fail('This key belongs to another or cancelled action.','IDEMPOTENCY_CONFLICT',409);return {...jobView(existing),reused:true};}
    if(body.place!==undefined&&typeof body.place!=='boolean')fail('Invalid placement choice.');
    const alt=text(input.alt_text,'Image description',1000);const direction=text(input.direction,'Art direction',2000,{optional:true});
    text(input.caption,'Caption',500,{optional:true});
    const ratio=input.aspect_ratio||'4:3';if(!['4:3','3:4','16:9','1:1'].includes(ratio))fail('Unsupported image shape.');
    const ctx=store.current(id);if(ctx.game.revision!==body.expected_revision)fail('The story changed. Review your target.','STORY_CHANGED',409);
    capacity(id);const selected=target(id,input);const profile=providers.exposure('illustrator');
    if(!input.provider_id||profile.provider?.id!==input.provider_id||profile.model_id!==input.model)fail('The illustrator changed. Review it before painting.','STORY_PROVIDER_CHANGED',409);
    providers.resolve('illustrator',{capability:'image'});
    const prompt=input.kind?imagePrompt(selected,direction):`Illustrate this fictional passage only. No text overlays.\nPassage:\n${selected.prose.slice(0,12000)}\nArt direction:\n${direction}`;
    const job=randomUUID();
    tx(()=>{if(db.prepare("SELECT id FROM fiction_art_jobs WHERE game_id=? AND status='running'").get(id))fail('A painting is already in progress.','ART_BUSY',409);db.prepare("INSERT INTO fiction_art_jobs(id,game_id,action_key,fingerprint,branch_id,head_id,expected_revision,status,billed_attempts) VALUES(?,?,?,?,?,?,?,'running',1)").run(job,id,key,fingerprint,ctx.branch.id,ctx.branch.head_beat_id,body.expected_revision);});
    let cost=null;let asset;
    try{
      const result=await generateIllustration({prompt,aspectRatio:ratio,resolution:'1K',quality:'low'});
      cost=Number.isFinite(result.cost)&&result.cost>=0?result.cost:null;
      asset=media.persist(await normalizeImage(result.buffer,result.mediaType));
      tx(()=>{insert(id,asset,alt,'paint');db.prepare("UPDATE fiction_art_jobs SET cost_usd=?,asset_id=?,status=CASE WHEN status='running' THEN 'succeeded' ELSE status END WHERE id=?").run(cost,asset.id,job);});
      // Inventory success is independent of attachment. A stale or cancelled action keeps its ready image.
      const row=db.prepare('SELECT * FROM fiction_art_jobs WHERE id=?').get(job);const now=store.current(id);
      if(body.place&&row.status==='succeeded'&&now.game.revision===row.expected_revision&&now.branch.id===row.branch_id&&now.branch.head_beat_id===row.head_id&&!store.view(id).pending){
        try{const placement=Object.fromEntries(Object.entries(input).filter(([key])=>['beat_id','kind','subject_id','alt_text','caption'].includes(key)));attach(id,row.expected_revision,asset,placement);db.prepare('UPDATE fiction_art_jobs SET placed=1 WHERE id=?').run(job);}catch{/* Ready inventory remains available for an explicit placement. */}
      }
      return {...status(id,key),story:store.view(id)};
    }catch(error){
      if(asset&&!db.prepare('SELECT id FROM fiction_assets WHERE id=?').get(asset.id))media.discard(asset);
      if(Number.isFinite(error.costUsd))cost=error.costUsd;
      db.prepare("UPDATE fiction_art_jobs SET cost_usd=?,status=CASE WHEN status='running' THEN 'failed' ELSE status END,error_code=? WHERE id=?").run(cost,error.code||'IMAGE_FAILED',job);
      error.costUsd=cost;error.billedAttempts=1;throw error;
    }
  }
  function reconcile(){db.prepare("UPDATE fiction_art_jobs SET status='interrupted',error_code='INTERRUPTED' WHERE status='running'").run();}
  router.get(`${base}/targets`,(req,res)=>{
    const ctx=queries.context(req.params.id,req.query);const offset=Number(req.query.offset||0);const q=text(req.query.q,'Passage search',200,{optional:true}).toLowerCase();
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('Invalid target page.');
    const rows=store.publicationRows(req.params.id,ctx.head).filter(row=>!q||row.prose.toLowerCase().includes(q));
    res.json({...queries.metadata(ctx),targets:rows.slice(offset,offset+40).map(row=>({id:row.id,excerpt:row.prose.slice(0,240)})),next_offset:rows.length>offset+40?offset+40:null});
  });
  router.get(base,(req,res)=>res.json(list(req.params.id,req.query)));
  router.get(`${base}/jobs/:key`,(req,res)=>res.json(status(req.params.id,req.params.key)));
  router.post(`${base}/jobs/:key/cancel`,(req,res)=>{text(req.params.key,'Action key',200);res.json(cancel(req.params.id,req.params.key));});
  router.post(`${base}/paint`,async(req,res,next)=>{try{res.json(await paint(req.params.id,req.body));}catch(error){next(error);}});
  router.post(`${base}/upload`,async(req,res,next)=>{let file;try{file=await receiveImageUpload(req,path.join(media.directory,'staging'));keys(file.fields,['alt_text'],'Gallery upload');res.status(201).json(await upload(req.params.id,file,file.fields.alt_text));}catch(error){next(error);}finally{if(file)fs.rmSync(file.path,{force:true});}});
  router.get(`${base}/:asset`,(req,res)=>res.json(detail(req.params.id,req.params.asset,req.query)));
  router.get(`${base}/:asset/thumbnail`,async(req,res,next)=>{try{const image=media.read(req.params.id,req.params.asset);res.set('Cache-Control','private, no-store').type('image/webp').send(await sharp(image.buffer).resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).webp().toBuffer());}catch(error){next(error);}});
  router.post(`${base}/:asset/place`,(req,res)=>{keys(req.body,['expected_revision','input','target_branch_id','expected_head_beat_id'],'Place retained image');const current=store.current(req.params.id);if(Object.hasOwn(req.body,'expected_head_beat_id')&&(req.body.target_branch_id!==current.branch.id||req.body.expected_head_beat_id!==current.branch.head_beat_id))fail('The placement destination changed.','STORY_TARGET_CHANGED',409);const asset=find(req.params.id,req.params.asset);res.json({story:attach(req.params.id,req.body.expected_revision,asset,req.body.input)});});
  return {router,list,detail,upload,paint,status,cancel,reconcile};
}
module.exports={createGallery};
