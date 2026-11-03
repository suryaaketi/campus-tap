import {WalkingRouter} from './router.js';

export function locationLink(pageURL,id,places) {
  if(!places.some(p=>p.id===id)) throw new Error('Unknown starting point');
  const url=new URL('./',pageURL);
  if(!['http:','https:'].includes(url.protocol)) throw new Error('Open the hosted website to make tag links');
  url.searchParams.set('start',id);
  return url.href;
}

export function inspectTagLink(value,pageURL,places) {
  let url;
  try {url=new URL(value);} catch {return {ok:false,message:'Paste the complete website URL, including https://.'};}
  const base=new URL('./',pageURL);
  if(url.origin!==base.origin || !['http:','https:'].includes(url.protocol) || url.username || url.password) return {ok:false,message:'This link points to a different website. Copy a fresh location link from this website.'};
  if(url.pathname!==base.pathname && url.pathname!==base.pathname+'index.html') return {ok:false,message:'The website folder in this link is incorrect. Keep the full campus-tap path.'};
  const starts=url.searchParams.getAll('start');
  const place=places.find(p=>p.id===starts[0]);
  if(starts.length!==1 || !place) return {ok:false,message:'This link does not identify one known starting point. Copy the link again.'};
  return {ok:true,place,message:`This link starts at ${place.name}. Open it on your phone to verify the page.`};
}

// Spreadsheet apps must treat observed notes as text rather than formulas.
export function csvCell(value) {
  let text=String(value??'').replaceAll('\0','');
  if(/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function recordsCSV(records) {
  const headers=['Recorded at','Device / OS','Test type','Start','Destination','Observed result','Seconds','Observations / fixes'];
  const rows=records.map(r=>[r.recordedAt,r.device,r.type,r.startName,r.destinationName,r.result,r.seconds??'',r.notes]);
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function validateRecord(input,places,now=new Date()) {
  const text=(value,max)=>String(value??'').trim().slice(0,max);
  const device=text(input.device,100),type=text(input.type,50),result=text(input.result,20),notes=text(input.notes,1200);
  const start=places.find(p=>p.id===input.start),destination=places.find(p=>p.id===input.destination);
  const types=['NFC tag scan','QR code scan','Route preview','Outdoor walking route','Live GPS walk','Failure / recovery'];
  if(!device) throw new Error('Enter the phone or device and operating system.');
  if(!types.includes(type) || !['Pass','Fail','Blocked'].includes(result)) throw new Error('Choose the test type and observed result.');
  if(!start || !destination || start.id===destination.id) throw new Error('Choose two different mapped locations.');
  if(!notes) throw new Error('Describe what you actually observed.');
  const raw=text(input.seconds,20),seconds=raw==='' ? null : Number(raw);
  if(seconds!==null && (!Number.isFinite(seconds)||seconds<0||seconds>3600)) throw new Error('Time must be between 0 and 3600 seconds, or blank.');
  return {recordedAt:now.toISOString(),device,type,start:start.id,startName:start.name,destination:destination.id,destinationName:destination.name,result,seconds,notes};
}
export function restoredRecords(raw,places) {
  try {
    const data=JSON.parse(raw);
    if(data.version!==1 || !Array.isArray(data.records)) return [];
    return data.records.slice(0,300).flatMap(record=>{
      try {const time=new Date(record.recordedAt);if(!Number.isFinite(time.getTime())) return [];return [validateRecord(record,places,time)];} catch {return [];}
    });
  } catch {return [];}
}

export async function websiteChecks(places,graph,pageURL,onProgress=()=>{},yieldUI=()=>Promise.resolve(),extras=[]) {
  const rows=[];
  const check=(name,pass,detail)=>rows.push({name,result:pass?'Pass':'Fail',detail});
  const valid=Array.isArray(places)&&places.length>1&&new Set(places.map(p=>p.id)).size===places.length;
  check('Starting-point data',valid,`${places.length} mapped locations with unique IDs`);
  if(!valid) return rows;
  check('NFC / QR link destinations',places.every(p=>inspectTagLink(locationLink(pageURL,p.id,places),pageURL,places).ok),`${places.length} location links keep this website’s folder and a known start`);
  check('Unknown tag locations',!inspectTagLink(new URL('?start=unknown-location',new URL('./',pageURL)).href,pageURL,places).ok,'An unknown start is rejected by the link checker');
  const router=new WalkingRouter(graph),total=places.length*places.length*2;
  let completed=0,connected=0,stairsFree=0,covered=0;
  for(const from of places) for(const to of places) for(const avoidStairs of [false,true]) {
    const route=router.route(from.point,to.point,{avoidStairs});
    if(route) {
      connected++;
      if(avoidStairs && route.edgeIndices.every(i=>!(graph.edges[i][4]&1))) stairsFree++;
      const steps=router.instructions(route);
      if(!route.edgeIndices.length || (steps.length && steps[0].startIndex===0 && steps.at(-1).endIndex===route.edgeIndices.length && steps.every((s,i)=>i===0||s.startIndex===steps[i-1].endIndex))) covered++;
    }
    completed++;onProgress(completed,total);
    if(completed%8===0) await yieldUI();
  }
  check('Mapped walking routes',connected===total,`${connected} / ${total} routes found, including both stairs settings`);
  check('Avoid mapped stairs',stairsFree===total/2,`${stairsFree} / ${total/2} routes exclude every edge marked as stairs`);
  check('Complete written instructions',covered===total,`${covered} / ${total} routes cover all route segments`);
  check('Outside-area routing',router.route([39.95,-75.16],places[0].point)===null,'A location outside the campus area has no fabricated route');
  if(extras.length) {
    const from=(places.find(p=>p.id==='hub')||places[0]).point,table=router.distancesFrom(from);
    const reachable=extras.filter(p=>{const snap=router.nearest(p.point);return snap.distance<=120&&Number.isFinite(table?.meters[snap.index]);}).length;
    check('Campus destinations',reachable===extras.length,`${reachable} / ${extras.length} buildings, parking garages and food places have a walking route from the HUB`);
  }
  return rows;
}
