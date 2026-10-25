'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { gzip, gunzip } = require('node:zlib');
const { promisify } = require('node:util');
const sharp = require('sharp');
const { assertTechnicalInput } = require('../imagery/art-store');
const { keys, fail } = require('./model');
const {validateCreativeSave}=require('./creative-save');
const {validateSave:validateV1}=require('./save-v1/validate');
const {validateEvidence}=require('./evidence');

const SAVE_FORMAT = 'ink-morrow-fiction-save';
const SAVE_MIME = 'application/vnd.inkmorrow.fiction-save';
const MAX_PACKED = 64 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const pack = promisify(gzip); const unpack = promisify(gunzip);
const record = (value, fields, label) => {
  keys(value, fields, label);
  if (fields.some((field) => !Object.hasOwn(value, field))) fail(`Missing ${label} field.`, 'INVALID_SAVE');
};
// A strict new-product save, not a legacy archive or a database migration.
// Validation never writes. Import always creates a new story and new media IDs.
function validateSave(value) {
  if (value?.version===1) return validateV1(value);
  record(value,['format','version','game','branches','beats','assets','spend','evidence',...(Object.hasOwn(value,'creative')?['creative']:[])],'Save');
  if(value.version!==2) fail('Unsupported playable-save version.','SAVE_VERSION_UNSUPPORTED');
  if(!Array.isArray(value.evidence)||value.evidence.length>120000)fail('Invalid evidence collection.','INVALID_SAVE');
  const baseline={...value,version:1};delete baseline.evidence;
  const result=Object.hasOwn(value,'creative')?validateCreativeSave(value,validateV1):validateV1(baseline);
  if(!Array.isArray(value.evidence)||value.evidence.length>120000) fail('Invalid evidence collection.','INVALID_SAVE');
  const seen=new Set();
  for(const evidence of value.evidence) {
    const beat=result.beats.get(evidence.beat_id);if(!beat) fail('Evidence refers to an unknown moment.','INVALID_SAVE');
    validateEvidence(evidence,beat,'save');const identity=evidence.beat_id+':'+evidence.change_index;
    if(seen.has(identity)) fail('Duplicate evidence identity.','INVALID_SAVE');seen.add(identity);
  }
  return result;
}

function createFictionSaves({ db, store, media }) {
  async function exportSave(id) {
    const current = store.current(id); const g = current.game;
    if (store.view(id).pending) fail('Wait for the current response before saving.', 'STORY_BUSY', 409);
    const size = db.prepare('SELECT count(*) AS n, coalesce(sum(length(CAST(prose AS BLOB))+length(CAST(summary AS BLOB))+length(CAST(input_json AS BLOB))+length(CAST(state_json AS BLOB))+length(CAST(changes_json AS BLOB))), 0) AS nbytes FROM fiction_beats WHERE game_id = ?').get(id);
    const imageSize = db.prepare('SELECT coalesce(sum(byte_size), 0) AS n FROM fiction_assets WHERE game_id = ?').get(id).n;
    const extraBytes=store.creativeRecords?db.prepare('SELECT (SELECT coalesce(sum(length(CAST(value_json AS BLOB))),0) FROM fiction_config_revisions WHERE game_id=?)+(SELECT coalesce(sum(length(CAST(value_json AS BLOB))+length(CAST(bindings_json AS BLOB))),0) FROM fiction_reference_revisions WHERE game_id=?)+(SELECT coalesce(sum(length(CAST(manifest_json AS BLOB))),0) FROM fiction_narrative_assemblies WHERE beat_id IN (SELECT id FROM fiction_beats WHERE game_id=?))+(SELECT coalesce(sum(length(CAST(quote AS BLOB))+64),0) FROM fiction_effect_evidence WHERE game_id=?) AS n').get(id,id,id,id).n:0;
    if (size.n > 10000 || size.nbytes + Math.ceil(imageSize*4/3) + extraBytes > MAX_EXPANDED) fail('This story exceeds the portable save limit (10,000 moments / 128 MB expanded).', 'SAVE_TOO_LARGE', 413);
    const value = { format: SAVE_FORMAT, version: 2,
      game: { id, title: g.title, premise: g.premise, genre: g.genre, initial_state: JSON.parse(g.initial_state_json), active_branch_id: g.active_branch_id },
      branches: db.prepare('SELECT id, name, parent_branch_id, fork_beat_id, head_beat_id FROM fiction_branches WHERE game_id = ? ORDER BY rowid').all(id),
      beats: db.prepare('SELECT * FROM fiction_beats WHERE game_id = ? ORDER BY rowid').all(id).map((row) => ({ id: row.id, branch_id: row.branch_id, parent_id: row.parent_id, kind: row.kind,
        prose: row.prose, summary: row.summary, input: JSON.parse(row.input_json), state: JSON.parse(row.state_json), changes: JSON.parse(row.changes_json) })),
      assets: db.prepare('SELECT id FROM fiction_assets WHERE game_id = ? ORDER BY rowid').all(id).map(({ id: assetId }) => {
        const image = media.read(id, assetId);
        return { id: image.id, media_type: image.media_type, sha256: image.sha256, width: image.width, height: image.height, content_base64: image.buffer.toString('base64') };
      }), evidence:db.prepare('SELECT beat_id,change_index,source_kind,source_beat_id,source_field,quote,sha256,visibility FROM fiction_effect_evidence WHERE game_id=? ORDER BY rowid').all(id), spend: store.view(id).spend };
    if(store.creativeRecords){
      const configs=db.prepare('SELECT id,parent_id,beat_id,value_json,public_change FROM fiction_config_revisions WHERE game_id=? ORDER BY rowid').all(id);
      const refs=db.prepare('SELECT id,parent_id,beat_id,subject_kind,subject_id,value_json,source_json,bindings_json,public_change FROM fiction_reference_revisions WHERE game_id=? ORDER BY rowid').all(id);
      const assemblies=db.prepare('SELECT beat_id,manifest_json FROM fiction_narrative_assemblies WHERE beat_id IN (SELECT id FROM fiction_beats WHERE game_id=?)').all(id);
      value.creative={version:1,configurations:configs.map(({value_json,...row})=>({...row,value:JSON.parse(value_json)})),references:refs.map(({subject_kind,value_json,source_json,bindings_json,...row})=>({...row,kind:subject_kind,value:JSON.parse(value_json),source:source_json?JSON.parse(source_json):null,binding_fact_ids:JSON.parse(bindings_json)})),assemblies:assemblies.map(row=>({beat_id:row.beat_id,manifest:JSON.parse(row.manifest_json)}))};
    }
    const json = Buffer.from(JSON.stringify(value));
    if (json.length > MAX_EXPANDED) fail('This save exceeds the 128 MB expanded limit.', 'SAVE_TOO_LARGE', 413);
    const buffer = await pack(json);
    if (buffer.length > MAX_PACKED) fail('This save exceeds the 64 MB file limit.', 'SAVE_TOO_LARGE', 413);
    return buffer;
  }
  async function decode(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PACKED) fail('Upload an InkMorrow 5 save no larger than 64 MB.', 'SAVE_TOO_LARGE', 413);
    let value;
    try { value = JSON.parse((await unpack(buffer, { maxOutputLength: MAX_EXPANDED })).toString('utf8')); }
    catch { fail('The save is damaged, unsupported or exceeds the 128 MB expanded limit.', 'INVALID_SAVE'); }
    try { validateSave(value); }
    catch (error) { if (error.statusCode) throw error; fail('The save contains malformed story data.', 'INVALID_SAVE'); }
    for (const asset of value.assets) {
      if (asset.media_type !== 'image/webp' || typeof asset.content_base64 !== 'string' || asset.content_base64.length > 28 * 1024 * 1024) fail('Invalid saved image.', 'INVALID_SAVE');
      const bytes = Buffer.from(asset.content_base64, 'base64');
      if (bytes.toString('base64') !== asset.content_base64 || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) fail('Saved image integrity check failed.', 'INVALID_SAVE');
      assertTechnicalInput(bytes, 'image/webp');
      const metadata = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).metadata();
      if (metadata.width !== asset.width || metadata.height !== asset.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages || 1) !== 1 || metadata.exif || metadata.xmp || metadata.icc) fail('Saved images must be normalized, metadata-free still images.', 'INVALID_SAVE');
      try { await sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' }).stats(); }
      catch { fail('The saved image cannot be decoded safely.', 'INVALID_SAVE'); }
    }
    return value;
  }
  const preview = async (buffer) => {
    const value = await decode(buffer);
    return { version:value.version, title: value.game.title, paths: value.branches.length, moments: value.beats.length, images: value.assets.length, spend: value.spend,
      warning: 'This unencrypted save contains all paths, hidden story truth, private motives and directions. Import creates a separate copy; it never resumes a paid request.' };
  };
  async function importSave(buffer,actionKey=null) {
    const value = await decode(buffer);
    let fingerprint=null;
    if(actionKey!==null){
      if(typeof actionKey!=='string'||!actionKey.length||actionKey.length>200)fail('Invalid import action key.','INVALID_SAVE');
      fingerprint=createHash('sha256').update(buffer).digest('hex');
      const receipt=db.prepare('SELECT * FROM fiction_local_receipts WHERE action_key=?').get(actionKey);
      if(receipt){if(receipt.kind!=='import'||receipt.fingerprint!==fingerprint)fail('This import key belongs to a different save.','IDEMPOTENCY_CONFLICT',409);try{return store.view(receipt.result_id);}catch{fail('The previously imported story is no longer available.','CREATION_RESULT_DELETED',410);}}
    }
     const gameId = randomUUID(); const staged = [];
    const branchIds = new Map(value.branches.map((row) => [row.id, randomUUID()]));
    const beatIds = new Map(value.beats.map((row) => [row.id, randomUUID()])); const assetIds = new Map();
    const configIds=new Map((value.creative?.configurations||[]).map(row=>[row.id,randomUUID()]));
    const referenceIds=new Map((value.creative?.references||[]).map(row=>[row.id,randomUUID()]));
    const remapConfig=value=>({...value,...(value.scene_plan?{scene_plan:{...value.scene_plan,id:configIds.get(value.scene_plan.id)}}:{})});
    const beatRef = (id) => id === null ? null : beatIds.get(id);
    const remapFact = (fact) => ({ ...fact, evidence_beat_id: beatRef(fact.evidence_beat_id) });
    const remapState = (state) => ({ ...state,...(state.version===2?{config_revision_id:state.config_revision_id===null?null:configIds.get(state.config_revision_id),reference_heads:Object.fromEntries(Object.entries(state.reference_heads).map(([key,id])=>[key,referenceIds.get(id)])),consumed_scene_plan_id:state.consumed_scene_plan_id===null?null:configIds.get(state.consumed_scene_plan_id),...(state.scene_frame?{scene_frame:{...state.scene_frame,beat_id:beatRef(state.scene_frame.beat_id)}}:{})}:{}), facts: state.facts.map(remapFact),
      ...(state.visuals ? { visuals: state.visuals.map((item) => ({ ...item, asset_id: assetIds.get(item.asset_id) })) } : {}),
      episode: { ...state.episode, ...(Object.hasOwn(state.episode, 'payoff_beat_id') ? { payoff_beat_id: beatRef(state.episode.payoff_beat_id) } : {}) },
      ...(state.adjudications ? { adjudications: state.adjudications.map((entry) => ({ ...entry, beat_id: beatRef(entry.beat_id) })) } : {}),
      illustrations: state.illustrations.map((item) => ({ ...item, beat_id: beatRef(item.beat_id), asset_id: assetIds.get(item.asset_id) })),
      scene_history: state.scene_history.map((item) => ({ ...item, beat_id: beatRef(item.beat_id) })) });
    let committed = false;
    try {
      for (const asset of value.assets) {
        const saved = media.persist({ buffer: Buffer.from(asset.content_base64, 'base64'), mediaType: asset.media_type, width: asset.width, height: asset.height });
        staged.push(saved); assetIds.set(asset.id, saved.id);
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('PRAGMA defer_foreign_keys = ON');
        const g = value.game;
        db.prepare('INSERT INTO fiction_games (id, title, premise, genre, initial_state_json, active_branch_id, revision) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(gameId, g.title, g.premise, g.genre, JSON.stringify(remapState(g.initial_state)), branchIds.get(g.active_branch_id), value.beats.length);
        for (const branch of value.branches) db.prepare('INSERT INTO fiction_branches (id, game_id, name, parent_branch_id, fork_beat_id, head_beat_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(branchIds.get(branch.id), gameId, branch.name, branch.parent_branch_id === null ? null : branchIds.get(branch.parent_branch_id), beatRef(branch.fork_beat_id), beatRef(branch.head_beat_id));
        const depth=new Map();const byId=new Map(value.beats.map(beat=>[beat.id,beat]));
        const position=id=>{if(id===null)return 0;if(depth.has(id))return depth.get(id);const chain=[];let at=id;while(at!==null&&!depth.has(at)){chain.push(at);at=byId.get(at).parent_id;}let n=at===null?0:depth.get(at);for(const next of chain.reverse())depth.set(next,++n);return depth.get(id);};
        for (const beat of [...value.beats].sort((a,b)=>position(a.id)-position(b.id))) db.prepare('INSERT INTO fiction_beats (id, game_id, branch_id, parent_id, kind, prose, summary, input_json, state_json, changes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(beatIds.get(beat.id), gameId, branchIds.get(beat.branch_id), beatRef(beat.parent_id), beat.kind, beat.prose, beat.summary, JSON.stringify(beat.input), JSON.stringify(remapState(beat.state)), JSON.stringify(beat.changes.map((change) => change.fact ? { ...change, fact: remapFact(change.fact), ...(Object.hasOwn(change, 'prior_evidence_beat_id') ? { prior_evidence_beat_id: beatRef(change.prior_evidence_beat_id) } : {}) } : change)));
        for (const asset of staged) db.prepare('INSERT INTO fiction_assets (id, game_id, media_type, sha256, byte_size, width, height, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(asset.id, gameId, asset.media_type, asset.sha256, asset.byte_size, asset.width, asset.height, asset.storage_key);
        for(const e of value.evidence||[]) db.prepare('INSERT INTO fiction_effect_evidence(game_id,beat_id,change_index,source_kind,source_beat_id,source_field,quote,sha256,visibility) VALUES(?,?,?,?,?,?,?,?,?)').run(gameId,beatRef(e.beat_id),e.change_index,e.source_kind,beatRef(e.source_beat_id),e.source_field,e.quote,e.sha256,e.visibility);
        for(const row of value.creative?.configurations||[])db.prepare('INSERT INTO fiction_config_revisions(id,game_id,parent_id,beat_id,value_json,public_change) VALUES(?,?,?,?,?,?)').run(configIds.get(row.id),gameId,row.parent_id===null?null:configIds.get(row.parent_id),beatRef(row.beat_id),JSON.stringify(remapConfig(row.value)),row.public_change);
        for(const row of value.creative?.references||[])db.prepare('INSERT INTO fiction_reference_revisions(id,game_id,subject_kind,subject_id,parent_id,beat_id,value_json,source_json,bindings_json,public_change) VALUES(?,?,?,?,?,?,?,?,?,?)').run(referenceIds.get(row.id),gameId,row.kind,row.subject_id,row.parent_id===null?null:referenceIds.get(row.parent_id),beatRef(row.beat_id),JSON.stringify(row.value),row.source?JSON.stringify(row.source):null,JSON.stringify(row.binding_fact_ids),row.public_change);
        for(const row of value.creative?.assemblies||[])db.prepare('INSERT INTO fiction_narrative_assemblies(beat_id,manifest_json) VALUES(?,?)').run(beatRef(row.beat_id),JSON.stringify(row.manifest));
        if(value.creative)store.creativeRecords.reindex(gameId);
        // Carry accounting, not request keys, provider configuration or authority.
        for (const [cost, attempts] of [[value.spend.known_usd, 0], [null, value.spend.unknown_attempts]]) {
          if (!cost && !attempts) continue;
          const id = randomUUID();
          db.prepare("INSERT INTO fiction_requests (id, game_id, branch_id, idempotency_key, fingerprint, expected_revision, status, billed_attempts, cost_usd, error_code, finished_at) VALUES (?, ?, ?, ?, ?, 0, 'interrupted', ?, ?, 'IMPORTED_SPEND', CURRENT_TIMESTAMP)")
            .run(id, gameId, branchIds.get(g.active_branch_id), id, id, attempts, cost);
        }
        if(actionKey!==null)db.prepare('INSERT INTO fiction_local_receipts(action_key,kind,fingerprint,result_id) VALUES(?,?,?,?)').run(actionKey,'import',fingerprint,gameId);
        db.exec('COMMIT'); committed = true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return store.view(gameId);
    } finally { if (!committed) staged.forEach(media.discard); }
  }
  return { exportSave, importSave, preview, decode };
}

module.exports = { createFictionSaves, validateSave, SAVE_FORMAT, SAVE_MIME, MAX_PACKED, MAX_EXPANDED };
