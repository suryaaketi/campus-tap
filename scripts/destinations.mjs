// Builds data/destinations.json: every named campus building, parking garage and food place inside
// the map area that the walking network can reach.
//
// Buildings come from data/basemap.geojson, which is already in this repository (OpenStreetMap data).
// Food places, parking garages and building entrances are downloaded from OpenStreetMap's Overpass API.
// If every Overpass server is busy, the buildings are still written and the download can be repeated later.
//
// Run from the repository root:
//   node scripts/destinations.mjs                       download food, parking and entrances, then write the file
//   node scripts/destinations.mjs --save-raw osm.json   also keep the download for a rebuild
//   node scripts/destinations.mjs --input osm.json      rebuild from a saved download, no internet needed
//   node scripts/destinations.mjs --offline             buildings only, no download
//   node scripts/destinations.mjs --server URL          use one specific Overpass server
//   node scripts/destinations.mjs --include-housing     also list apartment buildings and houses
//
// The eight NFC tag locations in data/places.json stay hand-checked and are never overwritten.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {WalkingRouter,metersBetween} from '../router.js';

export const BOUNDS=[[40.786,-77.876],[40.810,-77.849]]; // same area as the map's maxBounds
export const MAX_SNAP_METERS=120; // the router refuses to start or end farther than this from a path
const FOOD={restaurant:'Restaurant',fast_food:'Fast food',cafe:'Café',food_court:'Food court',ice_cream:'Ice cream'};
const SKIP_BUILDINGS=new Set(['garage','garages','shed','roof','construction','hut','kiosk','carport','service','transformer_tower','greenhouse','bunker','toilets','ruins','gazebo']);
// Private homes and apartment blocks are left out of a campus wayfinding list unless asked for.
const HOUSING=new Set(['apartments','house','detached','residential','semidetached_house','terrace','bungalow']);
const BAD_ENTRANCES=new Set(['service','emergency','exit','staircase','no']);
const BUILDING_LABELS={university:'Campus building',college:'Campus building',school:'Campus building',dormitory:'Residence hall',residential:'Residential building',apartments:'Apartment building',house:'House',church:'Place of worship',chapel:'Place of worship',stadium:'Athletics venue',grandstand:'Athletics venue',sports_hall:'Athletics venue',sports_centre:'Athletics venue',hospital:'Health services',office:'Office building',retail:'Shops',commercial:'Downtown building',hotel:'Hotel',library:'Library',parking:'Parking garage'};
// Featured tag locations already cover these buildings; the generated list must not repeat them.
const FEATURED_NAMES=['old main','berkey creamery','the berkey creamery','penn state berkey creamery','pattee library','paterno library','hetzel union building','hub robeson center','waring commons','pollock commons'];
export const CATEGORY_ORDER=['campus','study','food','parking'];

export const normalize=name=>String(name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll('&',' and ').replace(/[^a-z0-9]+/g,' ').trim();
export const slugify=name=>normalize(name).replaceAll(' ','-').slice(0,60).replace(/-+$/,'')||'place';
const round=value=>Math.round(value*1e7)/1e7;
const inBounds=([lat,lng],[[south,west],[north,east]]=BOUNDS)=>lat>=south && lat<=north && lng>=west && lng<=east;
const pretty=value=>String(value).split(';')[0].replaceAll('_',' ').replace(/^\w/,c=>c.toUpperCase());
const cellKey=(row,col)=>`${row}:${col}`;
const toCell=value=>Math.round(value*2e4); // about 5 m, so a 3x3 block covers any 2 m match

// Small request: food places, parking garages and entrance points only. Buildings are already local.
export function overpassQuery([[south,west],[north,east]]=BOUNDS) {
  const box=`${south},${west},${north},${east}`;
  return `[out:json][timeout:90];
(nwr["amenity"~"^(${Object.keys(FOOD).join('|')})$"]["name"](${box});nwr["amenity"="parking"]["parking"~"^(multi-storey|underground)$"]["name"](${box});node["entrance"](${box}););
out center;`;
}

// Named building outlines from the bundled base map, in the same shape as Overpass elements.
export function basemapElements(basemap) {
  return (basemap?.features||[]).flatMap(feature=>{
    const p=feature?.properties||{},g=feature?.geometry;
    if(p.layer!=='building' || !p.name || !g) return [];
    const outer=g.type==='Polygon' ? g.coordinates?.[0] : g.type==='MultiPolygon' ? g.coordinates?.[0]?.[0] : null;
    if(!outer?.length) return [];
    return [{type:p.osm_type||'way',id:p.osm_id,tags:{building:p.building||'yes',name:p.name},nodes:[],geometry:outer.map(([lon,lat])=>({lat,lon}))}];
  });
}

function ring(element) {
  const points=(element.geometry||[]).filter(p=>Number.isFinite(p?.lat) && Number.isFinite(p?.lon)).map(p=>[p.lat,p.lon]);
  if(points.length<4) return null;
  const [first,last]=[points[0],points.at(-1)];
  return first[0]===last[0] && first[1]===last[1] ? points : null;
}
function centroid(element) {
  if(Number.isFinite(element.lat) && Number.isFinite(element.lon)) return [element.lat,element.lon];
  if(Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)) return [element.center.lat,element.center.lon];
  const points=(element.geometry||[]).filter(p=>Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  const unique=points.length>1 && points[0].lat===points.at(-1).lat && points[0].lon===points.at(-1).lon ? points.slice(0,-1) : points;
  if(unique.length) return [unique.reduce((s,p)=>s+p.lat,0)/unique.length,unique.reduce((s,p)=>s+p.lon,0)/unique.length];
  const b=element.bounds;
  return b && [b.minlat,b.maxlat,b.minlon,b.maxlon].every(Number.isFinite) ? [(b.minlat+b.maxlat)/2,(b.minlon+b.maxlon)/2] : null;
}
export function pointInRing([lat,lng],points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [ai,bi]=points[i],[aj,bj]=points[j];
    if((bi>lng)!==(bj>lng) && lat<(aj-ai)*(lng-bi)/(bj-bi)+ai) inside=!inside;
  }
  return inside;
}
// Entrance nodes are corners of the building outline: match by node id, or by position for base-map outlines.
function entranceFor(element,entrances,grid) {
  let candidates=(element.nodes||[]).map(id=>entrances.get(id)).filter(Boolean);
  if(!candidates.length && grid.size) {
    const found=new Map();
    for(const v of element.geometry||[]) {
      if(!Number.isFinite(v?.lat) || !Number.isFinite(v?.lon)) continue;
      const row=toCell(v.lat),col=toCell(v.lon);
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) for(const e of grid.get(cellKey(row+dr,col+dc))||[]) {
        if(metersBetween([v.lat,v.lon],[e.lat,e.lon])<=2) found.set(e.id,e);
      }
    }
    candidates=[...found.values()];
  }
  candidates=candidates.filter(e=>!BAD_ENTRANCES.has(e.tags.entrance));
  const best=candidates.find(e=>e.tags.entrance==='main') || candidates[0];
  return best ? {point:[best.lat,best.lon],main:best.tags.entrance==='main'} : null;
}

export function buildDestinations(osm,graph,featured,options={}) {
  const bounds=options.bounds||BOUNDS,includeHousing=!!options.includeHousing;
  const router=new WalkingRouter(graph);
  const elements=[],seen=new Set(),entrances=new Map(),grid=new Map();
  for(const element of osm?.elements||[]) {
    if(element.type==='node' && element.tags?.entrance && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
      entrances.set(element.id,element);
      const key=cellKey(toCell(element.lat),toCell(element.lon));
      grid.set(key,[...(grid.get(key)||[]),element]);
    }
    const key=`${element.type}/${element.id}`;
    if(!element.tags?.name || seen.has(key)) continue;
    if(element.tags.building || element.tags.amenity) { seen.add(key); elements.push(element); }
  }
  const featuredByWay=new Map(featured.filter(p=>p.buildingOsmWay).map(p=>[p.buildingOsmWay,p]));
  const featuredNames=new Set(FEATURED_NAMES);
  const skipped={featured:0,housing:0,excluded:0,outside:0,unreachable:0,duplicate:0};
  const isFood=e=>Object.hasOwn(FOOD,e.tags.amenity);
  const isParking=e=>e.tags.amenity==='parking' || e.tags.building==='parking';

  // Buildings are read first: they become destinations and also tell food places which building they are inside.
  const buildings=elements.filter(e=>e.tags.building && !isFood(e)).map(e=>{
    const feature=e.type==='way' ? featuredByWay.get(e.id) : null;
    return {element:e,feature,shape:ring(e),entrance:entranceFor(e,entrances,grid),name:feature?.name || e.tags.name};
  });
  // Food and parking go first so that, when a building shares their name, the more specific entry is kept.
  const candidates=[];
  for(const e of elements.filter(e=>!e.tags.building || isFood(e))) {
    const tags=e.tags;
    if(!isFood(e) && !isParking(e)) continue;
    if(tags.access==='private' || tags.access==='no') { skipped.excluded++; continue; }
    if(isFood(e) && featuredNames.has(normalize(tags.name))) { skipped.featured++; continue; }
    let point=centroid(e);
    if(!point) continue;
    if(isParking(e)) {
      candidates.push({name:tags.name,category:'parking',icon:'parking',description:tags.parking==='underground' ? 'Underground parking' : 'Parking garage',detail:'Route to the nearest mapped path. Follow signs to the pedestrian entrance.',point,osm:`${e.type}/${e.id}`});
      continue;
    }
    const host=buildings.find(b=>b.shape && pointInRing(point,b.shape));
    const parts=[FOOD[tags.amenity]];
    if(tags.cuisine) parts.push(pretty(tags.cuisine));
    if(host) parts.push(`inside ${host.name}`);
    if(host) point=host.feature?.point || host.entrance?.point || point;
    candidates.push({name:tags.name,category:'food',icon:tags.amenity==='ice_cream' ? 'icecream' : 'food',description:parts.join(' · '),
      detail:host ? `Inside ${host.name}. The route goes to the building entrance.` : 'Route to the mapped location.',point,osm:`${e.type}/${e.id}`});
  }
  for(const b of buildings) {
    const e=b.element,tags=e.tags;
    if(b.feature || featuredNames.has(normalize(tags.name))) { skipped.featured++; continue; }
    if(HOUSING.has(tags.building) && !includeHousing) { skipped.housing++; continue; }
    if(SKIP_BUILDINGS.has(tags.building) || tags.access==='private') { skipped.excluded++; continue; }
    const parking=isParking(e), study=tags.amenity==='library' || tags.building==='library' || /\blibrary\b/i.test(tags.name);
    const category=parking ? 'parking' : study ? 'study' : 'campus';
    const point=b.entrance?.point || centroid(e);
    candidates.push({name:tags.name,category,icon:parking ? 'parking' : study ? 'book' : 'building',
      description:parking ? 'Parking garage' : BUILDING_LABELS[tags.building] || 'Building',
      detail:b.entrance ? `Route to the mapped ${b.entrance.main ? 'main ' : ''}entrance` : 'Route to the nearest mapped path. Follow signs to the entrance.',
      point,osm:`${e.type}/${e.id}`});
  }

  const used=new Set(featured.map(p=>p.id)),kept=new Map(),destinations=[];
  for(const c of candidates) {
    if(!c.point || !c.point.every(Number.isFinite) || !inBounds(c.point,bounds)) { skipped.outside++; continue; }
    if(router.nearest(c.point).distance>MAX_SNAP_METERS) { skipped.unreachable++; continue; }
    const key=normalize(c.name); // same name within 60 m is the same place, whatever the category
    if((kept.get(key)||[]).some(p=>metersBetween(p,c.point)<60)) { skipped.duplicate++; continue; }
    kept.set(key,[...(kept.get(key)||[]),c.point]);
    let id=slugify(c.name),n=2;
    while(used.has(id)) id=`${slugify(c.name)}-${n++}`;
    used.add(id);
    destinations.push({id,name:c.name,category:c.category,icon:c.icon,description:c.description,detail:c.detail,point:[round(c.point[0]),round(c.point[1])],osm:c.osm});
  }
  destinations.sort((a,b)=>CATEGORY_ORDER.indexOf(a.category)-CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  return {destinations,skipped};
}

export function destinationsFile(result,source,generatedAt=new Date().toISOString()) {
  const counts=Object.fromEntries(CATEGORY_ORDER.map(c=>[c,result.destinations.filter(d=>d.category===c).length]));
  const head={version:1,generatedAt,dataTimestamp:source?.osm3s?.timestamp_osm_base||null,basemapDate:source?.basemapDate||null,includesFoodAndParking:source?.downloaded!==false,
    source:'OpenStreetMap contributors (bundled base map and the Overpass API)',license:'ODbL 1.0',licenseUrl:'https://opendatacommons.org/licenses/odbl/',bounds:BOUNDS,counts};
  // One destination per line keeps git diffs readable when the data is regenerated.
  return `${JSON.stringify(head).slice(0,-1)},"destinations":[\n${result.destinations.map(d=>JSON.stringify(d)).join(',\n')}\n]}\n`;
}

// The main Overpass server is often busy (HTTP 429, 502, 504); try public mirrors before giving up.
export const SERVERS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://overpass.private.coffee/api/interpreter'];
async function download(servers) {
  const problems=[];
  for(const server of servers) {
    const host=new URL(server).host;
    try {
      console.log(`Downloading food places, parking garages and entrances from ${host}…`);
      const response=await fetch(server,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'campus-tap-destinations/1.0 (student wayfinding prototype)'},body:new URLSearchParams({data:overpassQuery()}),signal:AbortSignal.timeout(120000)});
      if(!response.ok) { problems.push(`${host} answered HTTP ${response.status}`); continue; }
      const osm=await response.json();
      if(/error|timed out/i.test(osm.remark||'')) { problems.push(`${host}: ${osm.remark}`); continue; }
      return osm;
    } catch(error) { problems.push(`${host}: ${error.message}`); }
  }
  throw new Error(problems.join('; '));
}

async function main(args) {
  const root=new URL('../',import.meta.url);
  const read=path=>JSON.parse(fs.readFileSync(new URL(path,root),'utf8'));
  const option=name=>{const i=args.indexOf(name);return i>=0 ? args[i+1] : null;};
  const basemap=read('data/basemap.geojson');
  let osm=null;
  if(option('--input')) osm=JSON.parse(fs.readFileSync(option('--input'),'utf8'));
  else if(!args.includes('--offline')) {
    try {
      osm=await download(option('--server') ? [option('--server')] : SERVERS);
      if(option('--save-raw')) fs.writeFileSync(option('--save-raw'),JSON.stringify(osm));
    } catch(error) {
      console.warn(`Food places, parking garages and entrances were not downloaded (${error.message}).`);
      console.warn('Writing campus buildings only. Run the same command again later to add food and parking.');
    }
  }
  const result=buildDestinations({elements:[...(osm?.elements||[]),...basemapElements(basemap)]},read('data/walking-graph.json'),read('data/places.json'),{includeHousing:args.includes('--include-housing')});
  fs.writeFileSync(new URL('data/destinations.json',root),destinationsFile(result,{osm3s:osm?.osm3s,basemapDate:basemap.metadata?.retrievedDate,downloaded:!!osm}));
  const counts=CATEGORY_ORDER.map(c=>`${c} ${result.destinations.filter(d=>d.category===c).length}`).join(', ');
  console.log(`Wrote data/destinations.json: ${result.destinations.length} destinations (${counts}).`);
  console.log(`Left out: ${Object.entries(result.skipped).map(([k,v])=>`${v} ${k}`).join(', ')}.`);
  if(!osm) console.log('Food places and parking garages are not included yet.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error=>{console.error(`Could not build destinations: ${error.message}`);process.exit(1);});
