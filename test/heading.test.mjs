import test from 'node:test';
import assert from 'node:assert/strict';
import {compassBearing,headingFromOrientation,smoothHeading,HeadingWatch,LocationWatch} from '../navigation.js';

const near=(actual,expected,tolerance=.5)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be about ${expected}`);

test('compass bearing is clockwise from north',()=>{
  const hub=[40.7983,-77.8617];
  near(compassBearing(hub,[40.7993,-77.8617]),0);
  near(compassBearing(hub,[40.7983,-77.8607]),90);
  near(compassBearing(hub,[40.7973,-77.8617]),180);
  near(compassBearing(hub,[40.7983,-77.8627]),270);
});

test('iPhone and Android compass events give a north-based heading; relative angles are ignored',()=>{
  assert.deepEqual(headingFromOrientation({webkitCompassHeading:90,webkitCompassAccuracy:12}),{heading:90,accuracy:12});
  assert.equal(headingFromOrientation({webkitCompassHeading:45,webkitCompassAccuracy:-1}).accuracy,null);
  assert.equal(headingFromOrientation({absolute:true,alpha:90}).heading,270);
  assert.equal(headingFromOrientation({absolute:true,alpha:0}).heading,0);
  assert.equal(headingFromOrientation({absolute:false,alpha:90}),null);
  assert.equal(headingFromOrientation({webkitCompassHeading:-1}),null);
  assert.equal(headingFromOrientation({}),null);
  assert.equal(headingFromOrientation(null),null);
});

test('smoothing turns the short way across north',()=>{
  near(smoothHeading(350,10,.5),0);
  near(smoothHeading(10,350,.5),0);
  near(smoothHeading(90,100,.25),92.5);
  assert.equal(smoothHeading(null,123),123);
});

function orientationTarget(permission) {
  const listeners=new Map();
  const target={
    ondeviceorientationabsolute:null,
    DeviceOrientationEvent:permission===undefined ? {} : {requestPermission:()=>permission},
    addEventListener(type,fn){listeners.set(type,fn);},
    removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}
  };
  return {target,listeners,fire(event){for(const fn of listeners.values())fn(event);}};
}

test('compass watch listens after permission, reports headings, and stops cleanly',async()=>{
  const readings=[],t=orientationTarget(Promise.resolve('granted'));
  const watch=new HeadingWatch(t.target,r=>readings.push(r),()=>5000);
  assert.equal(await watch.start(),'listening');
  assert.ok(t.listeners.has('deviceorientationabsolute'));
  t.fire({absolute:true,alpha:270});
  assert.equal(readings.at(-1).heading,90); assert.ok(watch.fresh());
  watch.stop(); assert.equal(t.listeners.size,0); assert.equal(watch.fresh(),false);
  t.fire({absolute:true,alpha:0}); assert.equal(readings.length,1);
});

test('denied compass permission and an early stop never attach a listener',async()=>{
  const denied=orientationTarget(Promise.resolve('denied'));
  assert.equal(await new HeadingWatch(denied.target,()=>{}).start(),'denied');
  assert.equal(denied.listeners.size,0);
  let grant;const slow=orientationTarget(new Promise(resolve=>{grant=resolve;}));
  const watch=new HeadingWatch(slow.target,()=>{});
  const pending=watch.start(); watch.stop(); grant('granted');
  assert.equal(await pending,'stopped'); assert.equal(slow.listeners.size,0);
  assert.equal(await new HeadingWatch({},()=>{}).start(),'unsupported');
});

test('GPS fixes carry direction of travel when the phone reports it',()=>{
  let success;const fixes=[];
  const geo={watchPosition(ok){success=ok;return 1;},clearWatch(){}};
  const watch=new LocationWatch(geo,fix=>fixes.push(fix),()=>{},()=>100000);
  watch.start();
  success({timestamp:100000,coords:{latitude:40.7983,longitude:-77.8617,accuracy:8,heading:135,speed:1.3}});
  success({timestamp:100001,coords:{latitude:40.7983,longitude:-77.8617,accuracy:8,heading:NaN,speed:null}});
  assert.equal(fixes[0].heading,135); assert.equal(fixes[0].speed,1.3);
  assert.equal(fixes[1].heading,null); assert.equal(fixes[1].speed,null);
  watch.stop();
});
