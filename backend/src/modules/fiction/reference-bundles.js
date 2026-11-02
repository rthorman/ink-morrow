'use strict';
const express=require('express');const {randomUUID,createHash}=require('node:crypto');const {gzipSync,gunzipSync}=require('node:zlib');const sharp=require('sharp');
const {keys,text,fail}=require('./model');const {templateInput}=require('./library-model');const {assertTechnicalInput}=require('../imagery/art-store');
const MIME='application/vnd.inkmorrow.reference-bundle';const MAX=64*1024*1024;const EXPANDED=128*1024*1024;
function createReferenceBundles({db,library,media}){
 const router=express.Router();const base='/api/fiction/reference-bundles';
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 function exportBundle(ids){
  if(!Array.isArray(ids)||!ids.length||ids.length>80||new Set(ids).size!==ids.length)fail('Select between 1 and 80 distinct references.');
  let size=0;
  const entries=ids.map(id=>{const item=library.get(id);let image=null;if(item.image_id){const asset=library.read(id,item.image_id);size+=Math.ceil(asset.buffer.length*4/3);if(size>EXPANDED)fail('Reference bundle is too large.','BUNDLE_TOO_LARGE',413);image={media_type:asset.media_type,width:asset.width,height:asset.height,sha256:asset.sha256,content_base64:asset.buffer.toString('base64'),alt_text:item.image_alt};}return {kind:item.kind,entry:{name:item.name,description:item.description,data:item.data},image};});
  const json=Buffer.from(JSON.stringify({format:'ink-morrow-reference-bundle',version:1,entries}));if(json.length>EXPANDED)fail('Reference bundle is too large.','BUNDLE_TOO_LARGE',413);const bytes=gzipSync(json);if(bytes.length>MAX)fail('Reference bundle is too large.','BUNDLE_TOO_LARGE',413);return bytes;
 }
 async function decode(bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX)fail('Choose a reference bundle up to 64 MB.');let value;
  try{value=JSON.parse(gunzipSync(bytes,{maxOutputLength:EXPANDED}));}catch{fail('Damaged or oversized reference bundle.','INVALID_BUNDLE');}
  keys(value,['format','version','entries'],'Reference bundle');if(value.format!=='ink-morrow-reference-bundle'||value.version!==1||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>80)fail('Unsupported reference bundle.');
  for(const item of value.entries){keys(item,['kind','entry','image'],'Bundled reference');item.entry=templateInput(item.kind,item.entry);if(item.image!==null){const image=item.image;keys(image,['media_type','width','height','sha256','content_base64','alt_text'],'Bundled image');text(image.alt_text,'Image description',1000);if(image.media_type!=='image/webp'||typeof image.content_base64!=='string'||image.content_base64.length>28*1024*1024)fail('Invalid bundled image.');const buffer=Buffer.from(image.content_base64,'base64');if(buffer.toString('base64')!==image.content_base64||digest(buffer)!==image.sha256)fail('Bundled image integrity check failed.');assertTechnicalInput(buffer,'image/webp');const metadata=await sharp(buffer,{limitInputPixels:4096*4096}).metadata();if(metadata.width!==image.width||metadata.height!==image.height||metadata.exif||metadata.xmp||metadata.icc||(metadata.pages||1)!==1)fail('Bundled image is not normalized.');await sharp(buffer,{limitInputPixels:4096*4096,failOn:'warning'}).stats();}}
  return value;
 }
 function previewValue(value){return {entries:value.entries.map(item=>({kind:item.kind,name:item.entry.name,has_image:Boolean(item.image),same_name:Boolean(db.prepare('SELECT id FROM fiction_templates WHERE deleted=0 AND kind=? AND name=?').get(item.kind,item.entry.name))})),warning:'Unencrypted private references, including lore and motives. Import creates new entries; no credentials, consent, journals or image-conditioning permissions travel.'};}
 async function preview(bytes){return previewValue(await decode(bytes));}
 async function importBundle(bytes,key){
  text(key,'Import action key',200);const fingerprint=digest(bytes);const prior=db.prepare('SELECT * FROM fiction_local_receipts WHERE action_key=?').get(key);
  if(prior){if(prior.kind!=='reference-bundle'||prior.fingerprint!==fingerprint)fail('This import key belongs to different content.','IDEMPOTENCY_CONFLICT',409);const ids=JSON.parse(prior.result_id);if(ids.some(id=>!db.prepare('SELECT id FROM fiction_templates WHERE id=? AND deleted=0').get(id)))fail('An earlier import result was deleted.','CREATION_RESULT_DELETED',410);return {ids,reused:true};}
  const value=await decode(bytes);const staged=[];let committed=false;
  try{
   const entries=value.entries.map(item=>{let asset=null;if(item.image){asset=media.persist({buffer:Buffer.from(item.image.content_base64,'base64'),mediaType:'image/webp',width:item.image.width,height:item.image.height});staged.push(asset);}return {...item,id:randomUUID(),asset};});
   db.exec('BEGIN IMMEDIATE');try{
    // Recheck after asynchronous decoding/staging; a concurrent identical import recovers its original copy.
    const raced=db.prepare('SELECT * FROM fiction_local_receipts WHERE action_key=?').get(key);if(raced){db.exec('ROLLBACK');return importBundle(bytes,key);}
    for(const item of entries){db.prepare('INSERT INTO fiction_templates(id,kind,name,description,data_json,image_id,image_alt) VALUES(?,?,?,?,?,?,?)').run(item.id,item.kind,item.entry.name,item.entry.description,JSON.stringify(item.entry.data),item.asset?.id||null,item.image?.alt_text||'');if(item.asset){const a=item.asset;db.prepare('INSERT INTO fiction_template_assets(id,template_id,storage_key,media_type,sha256,byte_size,width,height) VALUES(?,?,?,?,?,?,?,?)').run(a.id,item.id,a.storage_key,a.media_type,a.sha256,a.byte_size,a.width,a.height);}}
    const ids=entries.map(item=>item.id);db.prepare('INSERT INTO fiction_local_receipts(action_key,kind,fingerprint,result_id) VALUES(?,?,?,?)').run(key,'reference-bundle',fingerprint,JSON.stringify(ids));db.exec('COMMIT');committed=true;return {ids,reused:false};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{if(!committed)staged.forEach(media.discard);}
 }
 router.post(`${base}/export`,(req,res)=>{keys(req.body,['ids'],'Bundle selection');res.set('Cache-Control','private, no-store').attachment('InkMorrow-references.inkrefs').type(MIME).send(exportBundle(req.body.ids));});
 router.post(`${base}/preview`,express.raw({type:MIME,limit:MAX}),async(req,res,next)=>{try{res.json({preview:await preview(req.body)});}catch(error){next(error);}});
 router.post(`${base}/import`,express.raw({type:MIME,limit:MAX}),async(req,res,next)=>{try{res.status(201).json(await importBundle(req.body,req.get('Idempotency-Key')));}catch(error){next(error);}});
 return {router,exportBundle,preview,importBundle};
}
module.exports={createReferenceBundles,MIME};
