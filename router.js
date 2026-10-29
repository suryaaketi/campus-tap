export function metersBetween(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

class MinHeap {
  constructor() { this.items = []; }
  push(value) {
    const q = this.items;
    let i = q.length;
    q.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (q[p][0] <= value[0]) break;
      q[i] = q[p]; i = p;
    }
    q[i] = value;
  }
  pop() {
    const q = this.items, result = q[0], last = q.pop();
    if (q.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= q.length) break;
        if (c + 1 < q.length && q[c + 1][0] < q[c][0]) c++;
        if (last[0] <= q[c][0]) break;
        q[i] = q[c]; i = c;
      }
      q[i] = last;
    }
    return result;
  }
  get length() { return this.items.length; }
}

export class WalkingRouter {
  constructor(data) {
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('Invalid path data');
    this.data = data;
    this.adj = Array.from({ length: data.nodes.length }, () => []);
    data.edges.forEach((e, index) => {
      if (!Number.isInteger(e[0]) || !Number.isInteger(e[1]) || !this.adj[e[0]] || !this.adj[e[1]] || !(e[2] >= 0)) throw new Error('Invalid path connection');
      this.adj[e[0]].push([e[1], index]);
      this.adj[e[1]].push([e[0], index]);
    });
  }
  nearest(point, avoidStairs = false) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new Error('Invalid location');
    let best = -1, min = Infinity;
    const cos = Math.cos(point[0] * Math.PI / 180);
    this.data.nodes.forEach((p, i) => {
      if (avoidStairs && !this.adj[i].some(([, e]) => !(this.data.edges[e][4] & 1))) return;
      const d = (p[0] - point[0]) ** 2 + ((p[1] - point[1]) * cos) ** 2;
      if (d < min) { min = d; best = i; }
    });
    return { index: best, distance: best < 0 ? Infinity : metersBetween(point, this.data.nodes[best]) };
  }
  route(from, to, options = {}) {
    const avoidStairs = !!options.avoidStairs;
    const a = this.nearest(from, avoidStairs), b = this.nearest(to, avoidStairs);
    if (a.distance > 120 || b.distance > 120) return null;
    const n = this.data.nodes.length;
    const costs = new Float64Array(n); costs.fill(Infinity);
    const parent = new Int32Array(n); parent.fill(-1);
    const parentEdge = new Int32Array(n); parentEdge.fill(-1);
    const queue = new MinHeap();
    costs[a.index] = 0;
    queue.push([0, a.index, 0]);
    while (queue.length) {
      const [, current, cost] = queue.pop();
      if (cost !== costs[current]) continue;
      if (current === b.index) break;
      for (const [next, edgeIndex] of this.adj[current]) {
        const edge = this.data.edges[edgeIndex];
        if (avoidStairs && (edge[4] & 1)) continue;
        const weight = edge[2] * ((edge[4] & 2) ? 1.22 : 1) * ((edge[4] & 1) ? 1.15 : 1);
        const nextCost = cost + weight;
        if (nextCost >= costs[next]) continue;
        costs[next] = nextCost; parent[next] = current; parentEdge[next] = edgeIndex;
        const estimate = metersBetween(this.data.nodes[next], this.data.nodes[b.index]) * 0.98;
        queue.push([nextCost + estimate, next, nextCost]);
      }
    }
    if (!Number.isFinite(costs[b.index])) return null;
    const indices = [], edgeIndices = [];
    for (let i = b.index; i !== -1; i = parent[i]) {
      indices.push(i);
      if (parentEdge[i] !== -1) edgeIndices.push(parentEdge[i]);
    }
    indices.reverse(); edgeIndices.reverse();
    const distance = edgeIndices.reduce((sum, i) => sum + this.data.edges[i][2], 0) + a.distance + b.distance;
    return { points: indices.map(i => this.data.nodes[i]), indices, edgeIndices, distance, minutes: Math.max(1, Math.ceil(distance / 75)), startSnap: a, endSnap: b, hasStairs: edgeIndices.some(i => this.data.edges[i][4] & 1) };
  }
  instructions(route) {
    const edges=route.edgeIndices.map(i=>this.data.edges[i]), points=route.points;
    if (!edges.length) return [];
    const cumulative=[0];
    for(let i=0;i<edges.length;i++) cumulative.push(cumulative[i]+metersBetween(points[i],points[i+1]));
    const bearing=(a,b)=>Math.atan2((b[1]-a[1])*Math.cos(a[0]*Math.PI/180),b[0]-a[0])*180/Math.PI;
    const corner=index=>{
      let before=index-1, after=index+1;
      while(before>0 && cumulative[index]-cumulative[before]<9) before--;
      while(after<points.length-1 && cumulative[after]-cumulative[index]<9) after++;
      return ((bearing(points[index],points[after])-bearing(points[before],points[index])+540)%360)-180;
    };
    const path=edge=>(edge[4]&1) ? 'the mapped stairs' : this.data.names[edge[3]] || 'the campus walking path';
    const groups=[];
    let start=0;
    for(let i=1;i<edges.length;i++) {
      const changed=path(edges[i])!==path(edges[i-1]);
      const distance=cumulative[i]-cumulative[start];
      if(changed || (distance>=14 && cumulative.at(-1)-cumulative[i]>=10 && Math.abs(corner(i))>=43)) {
        groups.push({start,end:i}); start=i;
      }
    }
    groups.push({start,end:edges.length});
    return groups.map((g,i)=>{
      const change=i ? corner(g.start) : 0, stairs=!!(edges[g.start][4]&1);
      const maneuver=!i ? 'start' : change>35 ? 'right' : change< -35 ? 'left' : 'straight';
      const turn=!i ? 'Start' : maneuver==='right' ? 'Turn right' : maneuver==='left' ? 'Turn left' : 'Continue';
      return {text:`${turn} ${stairs ? 'using' : 'along'} ${path(edges[g.start])}`,distance:Math.round(cumulative[g.end]-cumulative[g.start]),stairs,maneuver,startIndex:g.start,endIndex:g.end,startDistance:cumulative[g.start],endDistance:cumulative[g.end]};
    });
  }
}
