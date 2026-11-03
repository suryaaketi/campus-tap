import { metersBetween } from './router.js';

// Project a GPS fix onto real route segments; never draw a route to an arbitrary point.
export function routeProgress(points, point) {
  if (!points.length) return null;
  if (points.length === 1) return { traveled:0, remaining:0, distanceToRoute:metersBetween(point,points[0]), point:points[0], index:0 };
  const scale = Math.cos(point[0] * Math.PI / 180);
  let best = null, traveled = 0, total = 0;
  for (let i=0; i<points.length-1; i++) {
    const a=points[i], b=points[i+1], dx=(b[1]-a[1])*scale, dy=b[0]-a[0];
    const denominator=dx*dx+dy*dy;
    const fraction=denominator ? Math.max(0,Math.min(1,(((point[1]-a[1])*scale)*dx+(point[0]-a[0])*dy)/denominator)) : 0;
    const projected=[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction];
    const distance=metersBetween(point,projected), length=metersBetween(a,b);
    if (!best || distance<best.distanceToRoute) best={traveled:traveled+length*fraction,distanceToRoute:distance,point:projected,index:i};
    traveled+=length; total+=length;
  }
  return {...best,remaining:Math.max(0,total-best.traveled)};
}

// Compass bearing from a to b: 0 = north, 90 = east, clockwise.
export function compassBearing(a, b) {
  const r=Math.PI/180, dLon=(b[1]-a[1])*r;
  const y=Math.sin(dLon)*Math.cos(b[0]*r);
  const x=Math.cos(a[0]*r)*Math.sin(b[0]*r)-Math.sin(a[0]*r)*Math.cos(b[0]*r)*Math.cos(dLon);
  return (Math.atan2(y,x)/r+360)%360;
}

// Heading tied to true or magnetic north, or null when the browser only reports a relative angle.
export function headingFromOrientation(event) {
  if (Number.isFinite(event?.webkitCompassHeading) && event.webkitCompassHeading>=0) {
    const accuracy=event.webkitCompassAccuracy;
    return {heading:event.webkitCompassHeading%360,accuracy:Number.isFinite(accuracy) && accuracy>=0 ? accuracy : null};
  }
  if (event?.absolute===true && Number.isFinite(event.alpha)) return {heading:(360-event.alpha)%360,accuracy:null};
  return null;
}

// Low-pass filter that turns the short way across north (350° → 10° passes through 0°, not 180°).
export function smoothHeading(previous, next, weight=.25) {
  if (!Number.isFinite(previous)) return next;
  const difference=((next-previous+540)%360)-180;
  return (previous+difference*weight+360)%360;
}

// Phone compass for the direction cone. start() must run inside a tap: iPhone only asks for permission then.
export class HeadingWatch {
  constructor(target,onHeading,now=()=>Date.now()) {
    this.target=target; this.onHeading=onHeading; this.now=now;
    this.type=null; this.handler=null; this.value=null; this.lastAt=0; this.generation=0;
  }
  start() {
    this.stop();
    const generation=this.generation, Orientation=this.target?.DeviceOrientationEvent;
    if (!Orientation) return Promise.resolve('unsupported');
    const listen=()=>{
      if (generation!==this.generation) return 'stopped';
      this.type='ondeviceorientationabsolute' in this.target ? 'deviceorientationabsolute' : 'deviceorientation';
      this.handler=event=>{
        const reading=headingFromOrientation(event); if (!reading) return;
        this.value=smoothHeading(this.value,reading.heading); this.lastAt=this.now();
        this.onHeading({heading:this.value,accuracy:reading.accuracy});
      };
      this.target.addEventListener(this.type,this.handler);
      return 'listening';
    };
    if (typeof Orientation.requestPermission==='function') {
      let request;
      try { request=Orientation.requestPermission(); } catch { return Promise.resolve('denied'); }
      return Promise.resolve(request).then(state=>state==='granted' ? listen() : 'denied',()=>'denied');
    }
    return Promise.resolve(listen());
  }
  fresh(maxAge=3000) { return !!this.handler && this.lastAt>0 && this.now()-this.lastAt<=maxAge; }
  stop() {
    this.generation++;
    if (this.handler) this.target.removeEventListener(this.type,this.handler);
    this.handler=null; this.type=null; this.value=null; this.lastAt=0;
  }
}

export function currentInstruction(steps, traveled) {
  const index=steps.findIndex(step=>step.endDistance>traveled+3);
  return index<0 ? Math.max(0,steps.length-1) : index;
}

// Kept separate from the UI so permission failures, late callbacks and Stop are testable.
export class LocationWatch {
  constructor(geolocation,onFix,onState,now=()=>Date.now()) {
    this.geo=geolocation; this.onFix=onFix; this.onState=onState; this.now=now;
    this.id=null; this.generation=0; this.active=false; this.lastTimestamp=0;
  }
  start() {
    this.stop();
    if (!this.geo) { this.onState('unsupported'); return; }
    this.active=true; this.lastTimestamp=0;
    const generation=this.generation;
    this.onState('locating');
    try {
      const id=this.geo.watchPosition(position=>{
        if (!this.active || generation!==this.generation) return;
        const {latitude,longitude,accuracy,heading,speed}=position.coords;
        if (![latitude,longitude,accuracy].every(Number.isFinite) || accuracy<0) { this.onState('weak'); return; }
        if (this.now()-position.timestamp>30000 || position.timestamp<=this.lastTimestamp) return;
        this.lastTimestamp=position.timestamp;
        if (accuracy>50) { this.onState('weak'); return; }
        this.onState('tracking');
        this.onFix({point:[latitude,longitude],accuracy,timestamp:position.timestamp,heading:Number.isFinite(heading) ? heading : null,speed:Number.isFinite(speed) ? speed : null});
      },error=>{
        if (!this.active || generation!==this.generation) return;
        if (error.code===1) { this.stop(); this.onState('denied'); }
        else this.onState(error.code===3 ? 'timeout' : 'unavailable');
      },{enableHighAccuracy:true,timeout:15000,maximumAge:2000});
      if (this.active && generation===this.generation) this.id=id;
      else this.geo.clearWatch(id);
    } catch { this.stop(); this.onState('unavailable'); }
  }
  stop() {
    this.active=false; this.generation++;
    if (this.id!==null) this.geo.clearWatch(this.id);
    this.id=null;
  }
}
