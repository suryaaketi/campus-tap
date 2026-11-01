import {locationLink,inspectTagLink,validateRecord,restoredRecords,recordsCSV,websiteChecks} from './prototype.js';
import {qrSVG,makeQR} from './signs.js';

const $=id=>document.getElementById(id);
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const storageKey='campus-tap-phone-tests-v1';
let places=[],records=[],automatedResults=[],checksRunAt=null,removed=null,toastTimer;
function toast(text){$('tools-toast').textContent=text;$('tools-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('tools-toast').hidden=true,3500);}
function notice(text){$('tools-error').textContent=text;$('tools-error').hidden=!text;}
function download(contents,type,filename){const url=URL.createObjectURL(new Blob([contents],{type}));const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify({version:1,records}));return true;}
  catch{$('storage-note').textContent='Browser storage is unavailable or full. These records remain while this page is open. Download them before leaving.';return false;}
}
function fillSelect(id,selected){
  $(id).replaceChildren(...places.map(place=>{const option=element('option','',place.name);option.value=place.id;return option;}));
  $(id).value=selected;
}
function makeSign(place){
  const url=locationLink(location.href,place.id,places),card=element('article','sign-card');
  card.append(element('div','sign-brand','Campus Tap.'),element('div','sign-kicker','YOUR STARTING POINT'),element('h3','',place.name));
  const qr=element('div','qr');
  const svg=new DOMParser().parseFromString(qrSVG(url),'image/svg+xml').documentElement;
  svg.setAttribute('role','img');svg.setAttribute('aria-label',`QR code for ${place.name}`);qr.append(document.importNode(svg,true));
  card.append(qr,element('div','sign-callout','Tap NFC or scan to find your way.'),element('p','sign-copy','Choose a destination. No app download.'),element('p','sign-link',url),element('small','sign-footer',`Tag: ${place.id} · Student prototype`));
  return card;
}
function renderSign(){
  const place=places.find(p=>p.id===$('sign-start').value);if(!place)return;
  $('sign-url').value=locationLink(location.href,place.id,places);
  $('sign-preview').replaceChildren(makeSign(place));
  $('download-qr').href=pngURL($('sign-url').value);$('download-qr').download=`campus-tap-${place.id}-qr.png`;$('download-qr').hidden=false;
}
function updateExports(){
  $('export-csv').disabled=records.length===0;
  $('export-report').disabled=records.length===0&&automatedResults.length===0;
}
function renderRecords(){
  $('record-rows').replaceChildren();$('record-count').textContent=records.length;$('empty-log').hidden=records.length>0;
  [...records].reverse().forEach((record,offset)=>{
    const index=records.length-1-offset,row=element('tr'),device=element('td','',record.device);
    device.append(element('small','',new Date(record.recordedAt).toLocaleString()));
    const trial=element('td','',record.type);trial.append(element('small','',`${record.startName} → ${record.destinationName}`));
    const result=element('td');result.append(element('span',`badge ${record.result.toLowerCase()}`,record.result));
    if(record.seconds!==null)result.append(element('small','',`${record.seconds} seconds`));
    const action=element('td'),remove=element('button','','Remove');remove.type='button';remove.setAttribute('aria-label',`Remove ${record.type} record from ${record.device}`);
    remove.addEventListener('click',()=>{removed={record,index};records.splice(index,1);persist();renderRecords();$('undo-row').hidden=false;});action.append(remove);
    row.append(device,trial,result,element('td','',record.notes),action);$('record-rows').append(row);
  });updateExports();
}
function renderChecks(){
  $('check-results').replaceChildren(...automatedResults.map(result=>{
    const row=element('li'),badge=element('span',`badge ${result.result.toLowerCase()}`,result.result),text=element('div');
    text.append(element('strong','',result.name),element('small','',result.detail));row.append(badge,text);return row;
  }));updateExports();
}

$('sign-start').addEventListener('change',renderSign);
$('copy-sign-link').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('sign-url').value);toast('NFC location link copied.');}
  catch{$('sign-url').focus();$('sign-url').select();let copied=false;try{copied=document.execCommand('copy');}catch{}toast(copied?'NFC location link copied.':'Copy the selected location link.');}
});
function pngURL(value){
  const qr=makeQR(value),count=qr.getModuleCount(),scale=8;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=(count+8)*scale;
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#000';
  for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))context.fillRect((col+4)*scale,(row+4)*scale,scale,scale);
  return canvas.toDataURL('image/png');
}
$('print-all').addEventListener('click',()=>{if(places.length)window.print();});
$('link-check-form').addEventListener('submit',event=>{
  event.preventDefault();const result=inspectTagLink($('tag-link-input').value.trim(),location.href,places);
  $('link-check-result').textContent=result.message;$('link-check-result').className=result.ok?'good':'bad';$('link-check-result').hidden=false;
});
$('run-checks').addEventListener('click',async()=>{
  $('run-checks').disabled=true;automatedResults=[];checksRunAt=null;renderChecks();$('checks-status').textContent='Loading map files…';
  try{
    const data=await Promise.all(['data/walking-graph.json','data/basemap.geojson','data/road-labels.json'].map(async path=>{const response=await fetch(path);if(!response.ok)throw new Error(`Could not load ${path}`);return response.json();}));
    if(!Array.isArray(data[1].features)||!Array.isArray(data[2]))throw new Error('The map background or labels have an unexpected format.');
    automatedResults=[{name:'Map files load',result:'Pass',detail:'Walking network, background geometry and road labels are available.'}];
    const rows=await websiteChecks(places,data[0],location.href,(done,total)=>{$('checks-status').textContent=`Checking routes: ${done} / ${total}`;},()=>new Promise(resolve=>setTimeout(resolve,0)));
    automatedResults.push(...rows);checksRunAt=new Date().toISOString();
    const failed=automatedResults.filter(row=>row.result==='Fail').length;
    $('checks-status').textContent=failed?`${failed} website check(s) failed. See details below.`:`${automatedResults.length} website checks passed. Phone and NFC tests remain in your observed test log.`;
  }catch(error){automatedResults.push({name:'Website checks',result:'Fail',detail:error.message||'A required map file or route check could not complete.'});checksRunAt=new Date().toISOString();$('checks-status').textContent='The website checks could not complete. Refresh and try again.';}
  finally{renderChecks();$('run-checks').disabled=false;}
});
$('test-form').addEventListener('submit',event=>{
  event.preventDefault();
  try{
    if(records.length>=300)throw new Error('This browser already has 300 records. Export them and remove old entries before adding more.');
    const record=validateRecord(Object.fromEntries(new FormData($('test-form'))),places);
    records.push(record);const saved=persist();renderRecords();
    $('record-status').textContent=saved?'Observed result saved in this browser.':'Result recorded for this page session. Download it before leaving.';
    $('test-notes').value='';$('test-seconds').value='';$('test-result').value='';
  }catch(error){$('record-status').textContent=error.message;}
});
$('undo-remove').addEventListener('click',()=>{if(!removed)return;records.splice(Math.min(removed.index,records.length),0,removed.record);removed=null;persist();renderRecords();$('undo-row').hidden=true;});
$('export-csv').addEventListener('click',()=>{if(records.length)download(recordsCSV(records),'text/csv;charset=utf-8','campus-tap-phone-tests.csv');});
$('export-report').addEventListener('click',()=>{
  const report={schemaVersion:1,exportedAt:new Date().toISOString(),website:new URL('./',location.href).href,automatedChecks:{runAt:checksRunAt,results:automatedResults},observedPhoneTests:records,scope:'Campus outdoor prototype. Automated checks do not establish NFC hardware compatibility, live GPS accuracy, current closures or complete accessibility.'};
  download(JSON.stringify(report,null,2),'application/json','campus-tap-test-report.json');
});

async function init(){
  try{
    const response=await fetch('data/places.json');if(!response.ok)throw new Error('Campus places could not load. Refresh to try again.');places=await response.json();
    fillSelect('sign-start','hub');fillSelect('test-start','hub');fillSelect('test-destination','library');renderSign();
    $('print-signs').replaceChildren(...places.map(makeSign));
    let raw;try{raw=localStorage.getItem(storageKey);}catch{$('storage-note').textContent='Browser storage is unavailable. Export results before leaving this page.';}
    records=restoredRecords(raw,places);renderRecords();
    if(location.hostname==='terminal.local'||location.hostname==='localhost'||location.hostname==='127.0.0.1')notice('Preview mode: these QR codes point to the local preview. Open the published website to make links for a real phone.');
  }catch(error){notice(error.message);for(const button of document.querySelectorAll('button'))button.disabled=true;}
}
init();
