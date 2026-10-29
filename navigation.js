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
        const {latitude,longitude,accuracy}=position.coords;
        if (![latitude,longitude,accuracy].every(Number.isFinite) || accuracy<0) { this.onState('weak'); return; }
        if (this.now()-position.timestamp>30000 || position.timestamp<=this.lastTimestamp) return;
        this.lastTimestamp=position.timestamp;
        if (accuracy>50) { this.onState('weak'); return; }
        this.onState('tracking');
        this.onFix({point:[latitude,longitude],accuracy,timestamp:position.timestamp});
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
