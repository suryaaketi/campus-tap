import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WalkingRouter,metersBetween} from '../router.js';

const graph=JSON.parse(fs.readFileSync(new URL('../data/walking-graph.json',import.meta.url)));
const places=JSON.parse(fs.readFileSync(new URL('../data/places.json',import.meta.url)));
const router=new WalkingRouter(graph);

test('every campus destination has a real, connected walking route',()=>{
  for(const origin of places)for(const destination of places){
    const route=router.route(origin.point,destination.point);
    assert.ok(route,`${origin.id} to ${destination.id}`);
    assert.ok(route.distance+1>=metersBetween(origin.point,destination.point),'route cannot be shorter than straight-line distance');
    assert.ok(route.distance<7000,'campus route should not leave the local area');
    assert.equal(route.edgeIndices.length,route.points.length-1);
    for(let i=0;i<route.edgeIndices.length;i++){
      const edge=graph.edges[route.edgeIndices[i]],a=route.indices[i],b=route.indices[i+1];
      assert.ok((edge[0]===a&&edge[1]===b)||(edge[0]===b&&edge[1]===a),'every segment must exist in OSM data');
    }
  }
});
test('avoiding mapped stairs produces no steps edges for all destinations',()=>{
  for(const origin of places)for(const destination of places){
    const route=router.route(origin.point,destination.point,{avoidStairs:true});
    assert.ok(route,`${origin.id} to ${destination.id}`);
    assert.equal(route.hasStairs,false);
    assert.ok(route.edgeIndices.every(i=>!(graph.edges[i][4]&1)));
  }
});
test('remote locations do not get a fabricated campus route',()=>{
  assert.equal(router.route([39.95,-75.16],places[0].point),null);
  assert.throws(()=>router.nearest([NaN,1]),/Invalid location/);
});
test('library route ends at a mapped entrance and yields usable steps',()=>{
  const library=places.find(p=>p.id==='library'),hub=places.find(p=>p.id==='hub');
  const route=router.route(hub.point,library.point);
  assert.ok(metersBetween(route.points.at(-1),library.point)<1);
  const steps=router.instructions(route);
  assert.ok(steps.length>0);
  assert.ok(steps.every(s=>s.text.length>0&&Number.isFinite(s.distance)));
});
