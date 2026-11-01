import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {locationLink,inspectTagLink,csvCell,recordsCSV,validateRecord,restoredRecords,websiteChecks} from '../prototype.js';
import {makeQR,qrSVG} from '../signs.js';

const places=JSON.parse(fs.readFileSync(new URL('../data/places.json',import.meta.url)));
const base='https://suryaaketi.github.io/campus-tap/tools.html#signs';
test('NFC and QR links keep the GitHub project folder and clear tools-page parameters',()=>{
  for(const p of places){const link=locationLink(base,p.id,places);assert.equal(link,`https://suryaaketi.github.io/campus-tap/?start=${p.id}`);assert.equal(inspectTagLink(link,base,places).place.id,p.id);}
  assert.throws(()=>locationLink(base,'unknown',places),/Unknown/);
  assert.throws(()=>locationLink('file:///tmp/index.html','hub',places),/hosted/);
});
test('tag checker rejects wrong hosts, folders, duplicate starts and unknown starts',()=>{
  for(const value of ['javascript:alert(1)','https://example.com/campus-tap/?start=hub','https://suryaaketi.github.io/?start=hub','https://suryaaketi.github.io/campus-tap/?start=nope','https://suryaaketi.github.io/campus-tap/?start=hub&start=library','not a URL'])assert.equal(inspectTagLink(value,base,places).ok,false,value);
  assert.equal(inspectTagLink('https://suryaaketi.github.io/campus-tap/index.html?start=hub',base,places).ok,true);
});
test('phone test records require an actual result and retain failure evidence',()=>{
  const input={device:'Phone / test OS',type:'NFC tag scan',start:'hub',destination:'library',result:'Fail',notes:'The notification did not appear.',seconds:'5.2'};
  const row=validateRecord(input,places,new Date('2026-10-31T16:00:00Z'));
  assert.equal(row.result,'Fail');assert.equal(row.seconds,5.2);assert.equal(row.startName,'HUB Robeson Center');
  assert.throws(()=>validateRecord({...input,result:''},places),/result/);
  assert.throws(()=>validateRecord({...input,destination:'hub'},places),/different/);
  assert.throws(()=>validateRecord({...input,seconds:'NaN'},places),/Time/);
  assert.throws(()=>validateRecord({...input,notes:''},places),/observed/);
  assert.deepEqual(restoredRecords(JSON.stringify({version:1,records:[row]}),places),[row]);
  assert.deepEqual(restoredRecords('malformed',places),[]);
});
test('CSV exports quote notes and prevent spreadsheet formula execution',()=>{
  assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('  @SUM(A1)'),'"\'  @SUM(A1)"');assert.equal(csvCell('a,"b"'),'"a,""b"""');
  const csv=recordsCSV([{device:'Phone',notes:'=1+1',result:'Fail',seconds:0}]);assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"0"'));
});
test('printable QR graphics include a quiet zone and encode all eight location URLs',()=>{
  for(const place of places){const value=locationLink(base,place.id,places),qr=makeQR(value),svg=qrSVG(value);assert.ok(qr.getModuleCount()>=21);assert.ok(svg.includes('<svg'));assert.ok(svg.includes('viewBox'));assert.ok(!svg.includes('<script'));assert.ok(svg.length>500);}
});
test('website self-check exercises all route combinations without making phone test records',async()=>{
  const graph=JSON.parse(fs.readFileSync(new URL('../data/walking-graph.json',import.meta.url)));let progress=0;
  const rows=await websiteChecks(places,graph,base,(done)=>progress=done);
  assert.equal(progress,128);assert.ok(rows.every(row=>row.result==='Pass'));
  assert.ok(rows.some(row=>row.detail.includes('128 / 128')));
  assert.ok(rows.every(row=>!Object.hasOwn(row,'device')));
});
