import test from 'node:test';
import assert from 'node:assert/strict';
import {LocationWatch,routeProgress,currentInstruction} from '../navigation.js';
import {WalkingRouter,metersBetween} from '../router.js';

test('route progress projects onto segments and counts remaining distance',()=>{
  const points=[[40,-77],[40.001,-77],[40.001,-76.999]];
  const start=routeProgress(points,points[0]),middle=routeProgress(points,[40.0005,-77]),end=routeProgress(points,points.at(-1));
  assert.equal(start.traveled,0); assert.ok(middle.traveled>50 && middle.traveled<60);
  assert.ok(middle.remaining<start.remaining); assert.ok(end.remaining<.1);
  assert.ok(routeProgress(points,[40.0005,-77.001]).distanceToRoute>70);
  assert.equal(routeProgress([points[0]],points[0]).remaining,0);
  assert.equal(routeProgress([],points[0]),null);
});
test('unnamed paths still produce left and right corner instructions',()=>{
  for(const [longitude,maneuver] of [[-76.999,'right'],[-77.001,'left']]) {
    const nodes=[[40,-77],[40.001,-77],[40.001,longitude]], edges=[[0,1,111,0,0],[1,2,85,0,0]];
    const router=new WalkingRouter({nodes,edges,names:['Campus path']});
    const steps=router.instructions({points:nodes,edgeIndices:[0,1]});
    assert.equal(steps.length,2);assert.equal(steps[1].maneuver,maneuver);
    assert.equal(steps[0].endDistance,steps[1].startDistance);
    assert.ok(Math.abs(steps.at(-1).endDistance-metersBetween(nodes[0],nodes[1])-metersBetween(nodes[1],nodes[2]))<.01);
    assert.equal(currentInstruction(steps,0),0);
    assert.equal(currentInstruction(steps,steps[1].startDistance+1),1);
  }
});
function fixture(){
  const fixes=[],states=[],cleared=[]; let success,error;
  const geo={watchPosition(ok,bad,options){success=ok;error=bad;assert.equal(options.enableHighAccuracy,true);return 7;},clearWatch(id){cleared.push(id);}};
  const watch=new LocationWatch(geo,fix=>fixes.push(fix),state=>states.push(state),()=>100000);
  return {watch,fixes,states,cleared,fix(timestamp=100000,accuracy=8){success({timestamp,coords:{latitude:40.7983,longitude:-77.8617,accuracy}});},fail(code){error({code});}};
}
test('stopping a GPS watch prevents late location callbacks',()=>{
  const f=fixture(); f.watch.start(); f.fix(); assert.equal(f.fixes.length,1);
  f.watch.stop(); assert.deepEqual(f.cleared,[7]); f.fix(100001); assert.equal(f.fixes.length,1);
});
test('poor, stale and duplicate GPS readings do not move the user',()=>{
  const f=fixture(); f.watch.start(); f.fix(60000); f.fix(99990,100); assert.equal(f.fixes.length,0);
  assert.ok(f.states.includes('weak'));f.fix(100000,8);f.fix(100000,8);assert.equal(f.fixes.length,1);
});
test('permission denial clears the watch; timeouts can recover',()=>{
  const denied=fixture(); denied.watch.start(); denied.fail(1); denied.fix(100001);
  assert.equal(denied.fixes.length,0);assert.equal(denied.states.at(-1),'denied');assert.deepEqual(denied.cleared,[7]);
  const retry=fixture(); retry.watch.start(); retry.fail(3); retry.fix();
  assert.ok(retry.states.includes('timeout'));assert.equal(retry.fixes.length,1);retry.watch.stop();
});
