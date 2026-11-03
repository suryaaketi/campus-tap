import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WalkingRouter} from '../router.js';
import {buildDestinations,basemapElements,destinationsFile,overpassQuery,pointInRing,slugify,BOUNDS,MAX_SNAP_METERS} from '../scripts/destinations.mjs';

const graph=JSON.parse(fs.readFileSync(new URL('../data/walking-graph.json',import.meta.url)));
const places=JSON.parse(fs.readFileSync(new URL('../data/places.json',import.meta.url)));
const router=new WalkingRouter(graph);

// A small straight walking path along latitude 40.798 is enough to test snapping and filtering.
const fixtureGraph={nodes:Array.from({length:21},(_,i)=>[40.798,-77.865+i*0.0005]),edges:Array.from({length:20},(_,i)=>[i,i+1,42,0,0]),names:['Path']};
const square=(south,west,north,east)=>[[south,west],[south,east],[north,east],[north,west],[south,west]].map(([lat,lon])=>({lat,lon}));
const hub={id:'hub',name:'HUB Robeson Center',point:[40.7983455,-77.8617234],buildingOsmWay:431712457};
const fixture={osm3s:{timestamp_osm_base:'2026-11-01T00:00:00Z'},elements:[
  {type:'way',id:431712457,tags:{building:'university',name:'Hetzel Union Building'},nodes:[],geometry:square(40.7979,-77.8622,40.7987,-77.8612)},
  {type:'way',id:100,tags:{building:'university',name:'Thomas Building'},nodes:[1,2,3,4,5,1],geometry:[{lat:40.7976,lon:-77.86},{lat:40.7976,lon:-77.8597},{lat:40.7976,lon:-77.8594},{lat:40.798,lon:-77.8594},{lat:40.798,lon:-77.86},{lat:40.7976,lon:-77.86}]},
  {type:'way',id:102,tags:{building:'university',name:'Thomas Building'},nodes:[],geometry:square(40.7978,-77.856,40.7982,-77.8555)},
  {type:'way',id:103,tags:{building:'garage',name:'Shed Garage'},nodes:[],geometry:square(40.7978,-77.858,40.798,-77.8578)},
  {type:'way',id:104,tags:{building:'parking',amenity:'parking',parking:'multi-storey',name:'East Deck'},nodes:[],geometry:square(40.7978,-77.8642,40.7982,-77.8638)},
  {type:'way',id:105,tags:{building:'university',name:'Paterno Library'},nodes:[],geometry:square(40.7978,-77.8650,40.798,-77.8648)},
  {type:'way',id:106,tags:{building:'university',name:'Life Sciences Library'},nodes:[],geometry:square(40.7978,-77.8632,40.798,-77.863)},
  {type:'node',id:2,lat:40.7976,lon:-77.8597,tags:{entrance:'main'}},
  {type:'node',id:300,lat:40.7982,lon:-77.8616,tags:{amenity:'fast_food',name:'Chick-fil-A'}},
  {type:'node',id:301,lat:40.7985,lon:-77.858,tags:{amenity:'cafe',name:'Corner Cafe',cuisine:'coffee_shop'}},
  {type:'node',id:302,lat:40.75,lon:-77.86,tags:{amenity:'restaurant',name:'Far Away Diner'}},
  {type:'node',id:303,lat:40.805,lon:-77.86,tags:{amenity:'restaurant',name:'Lonely Grill'}},
  {type:'way',id:104,tags:{building:'parking',amenity:'parking',parking:'multi-storey',name:'East Deck'},nodes:[],geometry:square(40.7978,-77.8642,40.7982,-77.8638)}
]};

test('one search from the start gives the same walking distance as each full route',()=>{
  const start=places.find(p=>p.id==='hub');
  for(const avoidStairs of [false,true]) {
    const table=router.distancesFrom(start.point,{avoidStairs});
    for(const place of places) {
      const route=router.route(start.point,place.point,{avoidStairs}),snap=router.nearest(place.point,avoidStairs);
      assert.ok(Math.abs(table.meters[snap.index]+snap.distance-route.distance)<1,`${place.id} avoidStairs=${avoidStairs}`);
    }
  }
  assert.equal(router.distancesFrom([39.95,-75.16]),null);
});

test('destination builder keeps reachable named places and routes food inside buildings to the entrance',()=>{
  const {destinations,skipped}=buildDestinations(fixture,fixtureGraph,[hub]);
  const byId=Object.fromEntries(destinations.map(d=>[d.id,d]));
  assert.deepEqual(Object.keys(byId).sort(),['chick-fil-a','corner-cafe','east-deck','life-sciences-library','thomas-building','thomas-building-2']);
  assert.deepEqual(byId['thomas-building'].point,[40.7976,-77.8597]); assert.match(byId['thomas-building'].detail,/main entrance/);
  assert.equal(byId['chick-fil-a'].category,'food'); assert.match(byId['chick-fil-a'].description,/inside HUB Robeson Center/);
  assert.deepEqual(byId['chick-fil-a'].point,hub.point);
  assert.equal(byId['corner-cafe'].description,'Café · Coffee shop');
  assert.equal(byId['east-deck'].category,'parking'); assert.equal(byId['east-deck'].icon,'parking');
  assert.equal(byId['life-sciences-library'].category,'study');
  assert.equal(skipped.featured,2); assert.equal(skipped.excluded,1); assert.equal(skipped.outside,1); assert.equal(skipped.unreachable,1);
  const file=JSON.parse(destinationsFile({destinations,skipped},fixture,'2026-11-03T00:00:00Z'));
  assert.equal(file.destinations.length,6); assert.equal(file.counts.parking,1); assert.equal(file.license,'ODbL 1.0');
});

test('destination helpers: slugs, point-in-building and the download query',()=>{
  assert.equal(slugify('Chick-fil-A @ HUB'),'chick-fil-a-hub'); assert.equal(slugify('Café & Bar'),'cafe-and-bar');
  const ring=square(40,-78,41,-77).map(p=>[p.lat,p.lon]);
  assert.equal(pointInRing([40.5,-77.5],ring),true); assert.equal(pointInRing([41.5,-77.5],ring),false);
  const query=overpassQuery(); assert.ok(query.includes('40.786,-77.876,40.81,-77.849')); assert.ok(query.includes('fast_food')); assert.ok(query.includes('multi-storey')); assert.ok(query.includes('entrance'));
});

test('base-map buildings get entrances by position, housing stays out, and one garage is listed once',()=>{
  const polygon=(west,east)=>({type:'Polygon',coordinates:[[[west,40.7976],[east,40.7976],[east,40.798],[west,40.798],[west,40.7976]]]});
  const basemap={features:[
    {properties:{layer:'building',name:'Willard Building',osm_type:'way',osm_id:500,building:'university'},geometry:polygon(-77.861,-77.8605)},
    {properties:{layer:'building',name:'Beaver Terrace',osm_type:'way',osm_id:501,building:'apartments'},geometry:polygon(-77.857,-77.8565)},
    {properties:{layer:'building',name:'West Deck',osm_type:'way',osm_id:502,building:'parking'},geometry:polygon(-77.8635,-77.863)},
    {properties:{layer:'road',name:'College Avenue'},geometry:{type:'LineString',coordinates:[[-77.86,40.79],[-77.85,40.79]]}}
  ]};
  const elements=basemapElements(basemap);
  assert.equal(elements.length,3); assert.deepEqual(elements[0].geometry[0],{lat:40.7976,lon:-77.861});
  const downloaded=[{type:'node',id:900,lat:40.7976003,lon:-77.8605002,tags:{entrance:'main'}},{type:'way',id:700,center:{lat:40.7978,lon:-77.86325},tags:{amenity:'parking',parking:'multi-storey',name:'West Deck'}}];
  const {destinations,skipped}=buildDestinations({elements:[...downloaded,...elements]},fixtureGraph,[hub]);
  const byId=Object.fromEntries(destinations.map(d=>[d.id,d]));
  assert.deepEqual(byId['willard-building'].point,[40.7976003,-77.8605002]); assert.match(byId['willard-building'].detail,/main entrance/);
  assert.equal(byId['beaver-terrace'],undefined); assert.equal(skipped.housing,1);
  assert.equal(destinations.filter(d=>d.name==='West Deck').length,1); assert.equal(byId['west-deck'].category,'parking'); assert.equal(skipped.duplicate,1);
  const withHousing=buildDestinations({elements},fixtureGraph,[hub],{includeHousing:true}).destinations;
  assert.equal(withHousing.find(d=>d.id==='beaver-terrace').description,'Apartment building');
});

const generated=new URL('../data/destinations.json',import.meta.url);
test('generated destination file is valid and every place is reachable',{skip:!fs.existsSync(generated) && 'run node scripts/destinations.mjs to create data/destinations.json'},()=>{
  const file=JSON.parse(fs.readFileSync(generated,'utf8')),ids=new Set(places.map(p=>p.id));
  assert.ok(file.destinations.length>0);
  const table=router.distancesFrom(places.find(p=>p.id==='hub').point);
  for(const d of file.destinations) {
    assert.ok(!ids.has(d.id),`${d.id} repeats an id`); ids.add(d.id);
    assert.ok(['campus','study','food','parking'].includes(d.category),d.id);
    assert.ok(d.name && d.description && d.detail,d.id);
    const [[south,west],[north,east]]=BOUNDS;
    assert.ok(d.point[0]>=south && d.point[0]<=north && d.point[1]>=west && d.point[1]<=east,`${d.id} outside the map`);
    const snap=router.nearest(d.point);
    assert.ok(snap.distance<=MAX_SNAP_METERS,`${d.id} is ${Math.round(snap.distance)} m from a path`);
    assert.ok(Number.isFinite(table.meters[snap.index]),`${d.id} unreachable from the HUB`);
  }
});

test('website self-check reports generated destinations when they are present',async()=>{
  const {websiteChecks}=await import('../prototype.js');
  const extras=[{id:'test-building',name:'Test',point:places.find(p=>p.id==='old-main').point}];
  const rows=await websiteChecks(places,graph,'https://suryaaketi.github.io/campus-tap/tools.html',()=>{},()=>Promise.resolve(),extras);
  const row=rows.find(r=>r.name==='Campus destinations');
  assert.equal(row.result,'Pass'); assert.match(row.detail,/1 \/ 1/);
});
