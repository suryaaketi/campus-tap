import { WalkingRouter, metersBetween } from './router.js';
import { LocationWatch, routeProgress, currentInstruction } from './navigation.js';

const paths = {
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  start:'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  nfc:'<path d="M6 7a8 8 0 0 0 0 10m3-8a5 5 0 0 0 0 6m9-8a8 8 0 0 1 0 10m-3-8a5 5 0 0 1 0 6"/><rect x="11" y="10" width="2" height="4" rx="1"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  food:'<path d="M5 3v6m3-6v6M2 3v6c0 2 6 2 6 0m-3 2v10M18 3c-3 2-4 6-4 9h5V3Zm1 9v9"/>',
  icecream:'<path d="m7 12 5 10 5-10H7Zm0 0a4 4 0 0 1-1-7 6 6 0 0 1 12 0 4 4 0 0 1-1 7"/><path d="M7 12h10"/>',
  landmark:'<path d="m3 8 9-5 9 5H3Zm0 13h18M5 10v8m5-8v8m4-8v8m5-8v8M3 18h18"/>',
  hub:'<rect x="4" y="5" width="16" height="16" rx="1"/><path d="M9 5V2h6v3M9 21v-6h6v6M7 9h2m6 0h2M7 12h2m6 0h2"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  back:'<path d="m14 5-7 7 7 7m-6-7h13"/>',
  external:'<path d="M14 3h7v7m0-7L11 13M10 4H4v16h16v-6"/>',
  walk:'<circle cx="14" cy="4" r="2"/><path d="m7 21 3-7 4 2 2 5m-6-7 2-6 3 4h4M6 12l3-4h3"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>'
};
paths.left='<path d="M19 20v-9a4 4 0 0 0-4-4H5m5-5L5 7l5 5"/>';
paths.right='<path d="M5 20v-9a4 4 0 0 1 4-4h10m-5-5 5 5-5 5"/>';
paths.straight='<path d="M12 21V3m-6 6 6-6 6 6"/>';
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.pin}</svg>`;
const $ = id => document.getElementById(id);
function el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function symbol(name, className = '') { const e = el('span',className); e.innerHTML = icon(name); return e; }
document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = icon(e.dataset.icon); });

let places = [], router, origin, destination = null, category = 'all', map, routeLayer, startMarker;
let markers = new Map(), routeCache = new Map(), currentRoute = null, toastTimer;
let avoidStairs = false, locationReading = false;
let walkMode=null, walkSteps=[], activeStep=0, phoneMarker=null, accuracyCircle=null, lastFix=null;
let followLocation=true, liveOriginSet=false, offRouteFixes=0, lastReroute=0, arrivalFixes=0;
const locationWatch=new LocationWatch(navigator.geolocation,receiveFix,locationState);
const params = new URLSearchParams(location.search);
const requestedStart = (params.get('start') || params.get('from') || '').toLowerCase();
const requestedDestination = (params.get('to') || '').toLowerCase();
const categoryNames = { study:'Study & library', food:'Food & dining', campus:'Campus landmark' };
const formatDistance = m => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(5,Math.round(m / 5) * 5)} m`;

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function message(text) { $('location-message').textContent = text; $('location-message').hidden = !text; }
function routeFor(place) {
  if (!router || !origin) return null;
  const key = `${origin.id}:${origin.point.join(',')}:${place.id}:${avoidStairs}`;
  if (!routeCache.has(key)) routeCache.set(key,router.route(origin.point,place.point,{avoidStairs}));
  return routeCache.get(key);
}
function updateAddress() {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('start',origin.id);
  if (destination) url.searchParams.set('to',destination.id);
  if (avoidStairs) url.searchParams.set('stairs','avoid');
  history.replaceState(null,'',url.pathname + url.search + url.hash);
}
function setOrigin(place, update = true) {
  origin = place;
  if (place.id === 'phone' && !$('start-select').querySelector('option[value="phone"]')) {
    const o = el('option','', 'Phone location (last fix)'); o.value = 'phone'; $('start-select').append(o);
  }
  $('start-select').value = place.id;
  $('origin-context').textContent = place.id === 'phone' ? walkMode==='live' ? 'Walk start from GPS. The blue dot follows you.' : 'From your phone’s last location reading.' : requestedStart === place.id ? 'Starting point supplied by this location link.' : 'Your route starts at this mapped location.';
  routeCache.clear();
  updateMarkers(); renderPlaces();
  if (destination?.id === origin.id) showPlaces();
  else if (destination) renderRoute();
  else fitMap();
  if (update) updateAddress();
}
function buildSelect() {
  for (const p of places) { const o = el('option','',p.name); o.value = p.id; $('start-select').append(o); }
}
function initMap() {
  if (!window.L) { $('map-status').textContent = 'The interactive map could not load. You can still choose a place and open walking directions.'; $('map-status').hidden = false; return; }
  map = L.map('map',{zoomControl:false,preferCanvas:true,minZoom:15,maxZoom:19,maxBounds:[[40.786,-77.876],[40.810,-77.849]],maxBoundsViscosity:0.8}).setView([40.7985,-77.8625],16);
  map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="sources.html" target="_blank" rel="noopener">Map data</a>');
  loadBasemap();
  L.control.zoom({position:'bottomright'}).addTo(map);
  map.on('dragstart',()=>{ if(walkMode) {followLocation=false; $('recenter-map').hidden=false;} });
  for (const p of places) {
    const marker = L.marker(p.point,{icon:L.divIcon({className:'campus-marker',html:`<span class="map-pin ${p.category}">${icon(p.icon)}</span>`,iconSize:[35,35],iconAnchor:[17,17]}),title:p.name,keyboard:true}).addTo(map);
    marker.bindTooltip(document.createTextNode(p.name),{direction:'top',offset:[0,-18]});
    marker.on('click',() => selectDestination(p.id)); markers.set(p.id,marker);
  }
}
async function loadBasemap() {
  try {
    const response = await fetch('data/basemap.geojson'); if (!response.ok) throw new Error('basemap');
    const data = await response.json();
    const features = data.features || [];
    for (const [name,z] of [['base-land',200],['base-buildings',210],['base-roads',220],['base-paths',230],['base-labels',350]]) { map.createPane(name); map.getPane(name).style.zIndex = z; map.getPane(name).style.pointerEvents = 'none'; }
    const group = names => ({type:'FeatureCollection',features:features.filter(f => names.includes(f.properties.layer))});
    L.geoJSON(group(['green','water','plaza']),{pane:'base-land',interactive:false,style:f => ({weight:0,fillColor:f.properties.layer === 'water' ? '#c8dce4' : f.properties.layer === 'plaza' ? '#ece9e1' : '#e0e9d5',fillOpacity:0.85})}).addTo(map);
    L.geoJSON(group(['building']),{pane:'base-buildings',interactive:false,style:{color:'#cdd0cc',weight:0.7,fillColor:'#e4e2dc',fillOpacity:1}}).addTo(map);
    const roads = group(['road']);
    const roadWeight = f => ['primary','secondary','tertiary'].includes(f.properties.highway) ? 8 : f.properties.highway === 'residential' ? 6 : 4;
    L.geoJSON(roads,{pane:'base-roads',interactive:false,style:f => ({color:'#d5d8d1',weight:roadWeight(f)+2,opacity:0.9,lineCap:'round'})}).addTo(map);
    L.geoJSON(roads,{pane:'base-roads',interactive:false,style:f => ({color:'#fffefa',weight:roadWeight(f),opacity:1,lineCap:'round'})}).addTo(map);
    L.geoJSON(group(['path']),{pane:'base-paths',interactive:false,style:f => ({color:f.properties.highway === 'steps' ? '#c4bba8' : '#fbfaf2',weight:f.properties.highway === 'pedestrian' ? 4 : 2.2,opacity:1,lineCap:'round',dashArray:f.properties.highway === 'steps' ? '1 3' : undefined})}).addTo(map);
    const labelsResponse = await fetch('data/road-labels.json');
    if (labelsResponse.ok) {
      const labels = await labelsResponse.json();
      const items = Array.isArray(labels) ? labels : labels.labels || [];
      const labelGroup = L.layerGroup().addTo(map);
      const rank = {primary:0,secondary:1,tertiary:2,residential:3,unclassified:4,service:5};
      items.sort((a,b) => (rank[a[3]] ?? 6) - (rank[b[3]] ?? 6));
      const update = () => {
        labelGroup.clearLayers();
        const zoom = map.getZoom(), occupied = [], size = map.getSize();
        if (zoom < 15) return;
        for (const label of items) {
          const name = label.name || label[0], lat = label.lat ?? label[1], lng = label.lng ?? label.lon ?? label[2], highway = label.highway || label[3];
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || (zoom < 17 && highway === 'service')) continue;
          const point = map.latLngToContainerPoint([lat,lng]);
          if (point.x < 75 || point.x > size.x - 75 || point.y < 90 || point.y > size.y - 70 || occupied.some(p => Math.abs(p.x-point.x)<150 && Math.abs(p.y-point.y)<30)) continue;
          occupied.push(point);
          const content = el('span','road-label-text',name); content.setAttribute('aria-hidden','true');
          L.marker([lat,lng],{pane:'base-labels',interactive:false,keyboard:false,icon:L.divIcon({className:'road-label',html:content,iconSize:[180,20],iconAnchor:[90,10]})}).addTo(labelGroup);
          if (occupied.length >= 24) break;
        }
      };
      map.on('moveend zoomend',update); update();
    }
  } catch (error) {
    $('map-status').textContent = 'The map background could not load. Your route line and written steps are still available. Refresh to retry the background.'; $('map-status').hidden = false;
    console.error('Campus map background unavailable.',error);
  }
}
function updateMarkers() {
  if (!map || !origin) return;
  for (const p of places) {
    const marker = markers.get(p.id);
    if (p.id === origin.id) { if (map.hasLayer(marker)) marker.remove(); }
    else {
      if (!map.hasLayer(marker)) marker.addTo(map);
      marker.setIcon(L.divIcon({className:'campus-marker',html:`<span class="map-pin ${p.category} ${p.id === destination?.id ? 'destination' : ''}">${icon(p.icon)}</span>`,iconSize:[35,35],iconAnchor:[17,17]}));
      marker.setZIndexOffset(p.id === destination?.id ? 1000 : 0);
    }
  }
  if (startMarker) startMarker.remove();
  startMarker = L.marker(origin.point,{icon:L.divIcon({className:'campus-marker',html:`<span class="map-pin start">${icon('start')}</span>`,iconSize:[35,35],iconAnchor:[17,17]}),title:`Starting point: ${origin.name}`,zIndexOffset:1200}).addTo(map);
  startMarker.bindTooltip(document.createTextNode(`Starting point: ${origin.name}`),{direction:'top',offset:[0,-15]});
}
function fitMap() {
  if (!map || !places.length) return;
  if (destination && currentRoute?.points.length > 1) map.fitBounds(L.latLngBounds(currentRoute.points),{padding:[62,75],maxZoom:17,animate:false});
  else if (destination) map.fitBounds([origin.point,destination.point],{padding:[70,75],maxZoom:17,animate:false});
  else map.fitBounds(places.map(p => p.point),{padding:[70,75],maxZoom:16,animate:false});
}
function renderPlaces() {
  if (!origin) return;
  const query = $('search').value.toLowerCase().trim();
  const filtered = places.filter(p => (category === 'all' || p.category === category) && `${p.name} ${p.description}`.toLowerCase().includes(query));
  const list = $('place-list'); list.replaceChildren();
  $('place-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'place' : 'places'}`;
  $('list-label').textContent = query ? 'SEARCH RESULTS' : category === 'all' ? 'EXPLORE CAMPUS' : categoryNames[category].toUpperCase();
  if (!filtered.length) { list.append(el('p','empty-state','No places match that search. Try “library”, “HUB”, or “food”.')); return; }
  filtered.forEach(p => {
    const card = el('button','place-card'); card.type = 'button'; card.dataset.place = p.id;
    card.append(symbol(p.icon,`place-symbol ${p.category}`));
    const details = el('span','place-info'); details.append(el('span','place-name',p.name),el('span','place-description',p.description));
    if (p.id === origin.id) { card.classList.add('is-start'); card.disabled = true; details.append(el('span','place-time here','Your starting point')); }
    else {
      const route = routeFor(p), time = el('span','place-time'); time.append(symbol('walk'));
      time.append(document.createTextNode(route ? `${route.minutes} min · ${formatDistance(route.distance)}` : router ? 'View walking options' : 'Loading walking route…'));
      details.append(time); card.append(symbol('arrow','place-arrow')); card.addEventListener('click',() => selectDestination(p.id));
    }
    card.insertBefore(details,card.lastElementChild?.classList.contains('place-arrow') ? card.lastElementChild : null); list.append(card);
  });
}
function selectDestination(id) {
  const p = places.find(p => p.id === id); if (!p) return;
  if (p.id === origin.id) { toast('This is your starting point. Choose another destination.'); return; }
  if(walkMode) endWalk();
  destination = p;
  $('places').hidden = true; $('route-view').hidden = false;
  renderRoute(); updateAddress();
  if (matchMedia('(max-width:700px)').matches) $('route-view').scrollIntoView({behavior:'smooth',block:'start'});
  else document.querySelector('.finder').scrollTo({top:0,behavior:'smooth'});
}
function showPlaces() {
  endWalk();
  destination = null; currentRoute = null;
  $('places').hidden = false; $('route-view').hidden = true;
  $('map-heading').textContent = 'University Park'; $('map-description').textContent = 'Campus to College Avenue';
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  updateMarkers(); renderPlaces(); fitMap(); updateAddress();
}
function renderRoute() {
  if (!destination) return;
  $('route-category').textContent = categoryNames[destination.category];
  $('route-title').textContent = destination.name; $('route-subtitle').textContent = destination.detail;
  $('avoid-stairs').checked = avoidStairs;
  currentRoute = routeFor(destination);
  $('route-steps').replaceChildren();
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  $('route-summary').hidden = !currentRoute;
  $('start-walk').disabled=$('preview-walk').disabled=!currentRoute || !map;
  $('route-state').textContent = !router ? 'Loading the campus walking paths…' : !currentRoute ? 'No mapped route is available with this starting point and setting. Choose another starting point or change the stairs setting.' : currentRoute.hasStairs ? 'This route includes mapped stairs.' : '';
  $('map-heading').textContent = destination.name; $('map-description').textContent = `Walking from ${origin.name}`;
  if (currentRoute) {
    $('route-minutes').textContent = `${currentRoute.minutes} min`; $('route-distance').textContent = formatDistance(currentRoute.distance);
    walkSteps = router.instructions(currentRoute); activeStep=0;
    if (currentRoute.startSnap.distance > 12) addStep('Join the highlighted outdoor path near your starting point.',formatDistance(currentRoute.startSnap.distance));
    for (let i=0;i<walkSteps.length;i++) addStep(walkSteps[i].text,formatDistance(walkSteps[i].distance),'',i);
    addStep(`Arrive near ${destination.name}`,destination.id === 'downtown-food' ? 'Dining area around College Avenue and Allen Street' : 'Follow signs to the entrance','arrival');
    $('step-count').textContent = `${$('route-steps').children.length} steps`;
    if (map) {
      routeLayer = L.featureGroup([
        L.polyline(currentRoute.points,{color:'#fff',weight:9,opacity:.95,lineCap:'round'}),
        L.polyline(currentRoute.points,{color:'#254f7d',weight:5,opacity:1,lineCap:'round'})
      ]).addTo(map);
    }
  } else { walkSteps=[]; $('step-count').textContent = ''; }
  updateMarkers(); if(!walkMode) fitMap();
  if(walkMode==='preview') renderPreview();
}
function addStep(text,distance,className='',index=null) {
  const item = el('li',className); if(index!==null) item.dataset.step=index;
  item.append(el('span','',text),el('small','',distance)); $('route-steps').append(item);
}
function walkingUI(mode) {
  walkMode=mode; document.body.classList.toggle('walking',!!mode);
  $('walk-hud').hidden=$('walk-controls').hidden=!mode;
  $('preview-controls').hidden=mode!=='preview';
  $('start-walk').hidden=$('preview-walk').hidden=!!mode;
  $('navigation-note').hidden=!!mode; $('stop-walk').textContent=mode==='preview' ? 'Close preview' : 'End walk';
  $('recenter-map').hidden=true; followLocation=true;
  requestAnimationFrame(()=>map?.invalidateSize());
}
function hud(title,detail,maneuver='walk') {
  $('walk-label').textContent=walkMode==='preview' ? 'ROUTE PREVIEW · SIMULATED' : 'LIVE WALK';
  $('walk-instruction').textContent=title; $('walk-detail').textContent=detail;
  $('walk-symbol').replaceChildren(symbol(paths[maneuver] ? maneuver : 'walk'));
}
function highlightStep() {
  document.querySelectorAll('[data-step]').forEach(item=>{
    const active=Number(item.dataset.step)===activeStep;
    item.classList.toggle('active-step',active);
    if(active) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
  });
  const arrival=$('route-steps').querySelector('.arrival');
  if(arrival) arrival.classList.toggle('active-step',activeStep===walkSteps.length);
}
function drawPosition(point,accuracy=null,simulated=false) {
  if(!map) return;
  if(!phoneMarker) phoneMarker=L.marker(point,{zIndexOffset:1800,keyboard:false}).addTo(map);
  phoneMarker.setLatLng(point).setIcon(L.divIcon({className:'position-marker',html:`<span class="live-dot${simulated ? ' simulated' : ''}"></span>`,iconSize:[20,20],iconAnchor:[10,10]}));
  phoneMarker.options.title=simulated ? 'Simulated position in route preview' : 'Your phone location';
  if(accuracy!==null) {
    if(!accuracyCircle) accuracyCircle=L.circle(point,{radius:accuracy,color:'#3475b8',weight:1,fillOpacity:.10,interactive:false}).addTo(map);
    accuracyCircle.setLatLng(point).setRadius(accuracy);
  } else if(accuracyCircle) {accuracyCircle.remove(); accuracyCircle=null;}
  if(followLocation) map.panTo(point,{animate:false});
}
function endWalk() {
  locationWatch.stop(); walkingUI(null); lastFix=null; liveOriginSet=false;
  if(phoneMarker) {phoneMarker.remove();phoneMarker=null;}
  if(accuracyCircle) {accuracyCircle.remove();accuracyCircle=null;}
  document.querySelectorAll('.active-step').forEach(item=>item.classList.remove('active-step'));
  document.querySelectorAll('[aria-current="step"]').forEach(item=>item.removeAttribute('aria-current'));
  if(origin?.id==='phone') $('origin-context').textContent='From your phone’s last location reading.';
}
function startPreview() {
  if(!currentRoute || !map) return;
  endWalk(); walkingUI('preview'); activeStep=0; message('');
  $('walk-status').textContent='Preview only. The orange dot is a simulated position; your location is not being used.';
  renderPreview();
  if(matchMedia('(max-width:700px)').matches) document.querySelector('.map-panel').scrollIntoView({block:'start'});
}
function renderPreview() {
  const step=walkSteps[activeStep];
  $('previous-step').disabled=activeStep===0; $('next-step').disabled=activeStep>=walkSteps.length;
  $('preview-count').textContent=`${activeStep+1} / ${walkSteps.length+1}`;
  hud(step?.text || `Arrive near ${destination.name}`,step ? `Follow the highlighted path for ${formatDistance(step.distance)}.` : 'Follow signs to the entrance.',step?.maneuver || 'pin');
  highlightStep();
  const point=step ? currentRoute.points[step.startIndex] : currentRoute.points.at(-1);
  drawPosition(point,null,true);
  if(map && followLocation) map.setView(point,17,{animate:false});
}
function startWalk() {
  if(!currentRoute || !map) return;
  if(!window.isSecureContext) { message('Live location needs HTTPS. On the published website, press Start walk and allow location access. You can use Preview route here.'); return; }
  endWalk(); message(''); walkingUI('live'); offRouteFixes=arrivalFixes=0;
  locationWatch.start();
  if(matchMedia('(max-width:700px)').matches) document.querySelector('.map-panel').scrollIntoView({block:'start'});
}
function locationState(state) {
  if(walkMode!=='live') return;
  const messages={locating:'Finding your location. Allow location access when your browser asks.',weak:'Waiting for a more accurate GPS reading. Try moving outdoors.',timeout:'Still waiting for GPS. Keep this page open or end the walk.',unavailable:'Location is temporarily unavailable. Keep this page open to retry.'};
  if(state==='denied' || state==='unsupported') {
    endWalk(); message(state==='denied' ? 'Location access was denied. Allow it in your browser settings, or use Preview route and the written steps.' : 'This browser does not provide live location. Use Preview route and the written steps.'); return;
  }
  if(messages[state]) { $('walk-status').textContent=messages[state]; hud(state==='locating' ? 'Finding your location…' : 'Waiting for GPS…',messages[state],'locate'); }
}
function receiveFix(fix) {
  if(walkMode!=='live') return;
  const [lat,lng]=fix.point;
  if(lat<40.787 || lat>40.809 || lng< -77.875 || lng> -77.850 || router.nearest(fix.point,avoidStairs).distance>120) {
    endWalk(); message('Your location is outside the mapped campus paths. Choose a starting point to preview a route.'); return;
  }
  lastFix=fix;
  if(!liveOriginSet) {
    liveOriginSet=true; lastReroute=fix.timestamp;
    setOrigin({id:'phone',name:'Your phone location',point:fix.point});
    if(map) map.setView(fix.point,17,{animate:false});
  }
  if(!currentRoute) {endWalk();message('A route from your phone location could not be found with this setting. Choose a nearby starting point or change the stairs setting.');return;}
  let progress=routeProgress(currentRoute.points,fix.point);
  offRouteFixes=progress.distanceToRoute>Math.max(35,fix.accuracy*1.5) ? offRouteFixes+1 : 0;
  if(offRouteFixes>=3 && fix.timestamp-lastReroute>=10000) {
    origin.point=fix.point; routeCache.clear(); renderRoute(); offRouteFixes=0; lastReroute=fix.timestamp;
    if(!currentRoute) {endWalk();message('No mapped route was found from here. Choose another starting point.');return;}
    progress=routeProgress(currentRoute.points,fix.point); toast('Walking route updated from your location.');
  }
  const remaining=progress.remaining+currentRoute.endSnap.distance+progress.distanceToRoute;
  activeStep=currentInstruction(walkSteps,progress.traveled); highlightStep();
  const step=walkSteps[activeStep];
  const near=metersBetween(fix.point,destination.point)<=18 && fix.accuracy<=25 && remaining<=35;
  arrivalFixes=near ? arrivalFixes+1 : 0;
  drawPosition(fix.point,fix.accuracy);
  $('route-minutes').textContent=`${Math.max(1,Math.ceil(remaining/75))} min`; $('route-distance').textContent=formatDistance(remaining);
  $('walk-status').textContent=`GPS active · accuracy about ${Math.round(fix.accuracy)} m. Keep this page open. Drag the map to look around; Recenter resumes following.`;
  hud(step?.text || `Continue to ${destination.name}`,`${formatDistance(Math.max(0,(step?.endDistance || 0)-progress.traveled))} on this step · ${formatDistance(remaining)} remaining`,step?.maneuver || 'walk');
  if(arrivalFixes>=2) {
    locationWatch.stop(); activeStep=walkSteps.length; highlightStep();
    $('route-minutes').textContent='Arrived'; $('route-distance').textContent='Nearby';
    $('walk-status').textContent='You are near the mapped destination. GPS updates have stopped. Follow signs to the entrance.';
    hud(`You’re near ${destination.name}`,'Walk complete. Follow signs to the entrance.','pin');
  }
}
function tagUrl(id) { const u = new URL(location.pathname,location.origin); u.searchParams.set('start',id); return u.href; }
async function copy(text,input) {
  try { await navigator.clipboard.writeText(text); toast('Location link copied. Ready to write to your tag.'); }
  catch {
    input.focus(); input.select();
    let copied = false; try { copied = document.execCommand('copy'); } catch {}
    toast(copied ? 'Location link copied. Ready to write to your tag.' : 'Select and copy the highlighted location link.');
  }
}
function setupTags() {
  const container = $('tag-links'); container.replaceChildren();
  for (const p of places) {
    const row = el('div','tag-row'), detail = el('div');
    const label = el('label','',p.name), input = el('input'); input.id = `tag-${p.id}`; input.value = tagUrl(p.id); input.readOnly = true; label.htmlFor = input.id;
    const button = el('button','', 'Copy link'); button.type='button'; button.setAttribute('aria-label',`Copy NFC link for ${p.name}`); button.addEventListener('click',() => copy(input.value,input));
    detail.append(label,input); row.append(detail,button); container.append(row);
  }
}
function openSetup() { setupTags(); $('setup-dialog').showModal(); }
async function getLocation() {
  if (locationReading) return;
  if(walkMode) endWalk();
  if (!navigator.geolocation) { message('This browser cannot provide a location. Choose a starting point instead.'); return; }
  locationReading = true; $('use-location').disabled = true; $('use-location').replaceChildren(symbol('locate'),document.createTextNode('Finding your location…')); message('');
  const finish = () => { locationReading = false; $('use-location').disabled = false; $('use-location').replaceChildren(symbol('locate'),document.createTextNode('Use my location')); };
  navigator.geolocation.getCurrentPosition(position => {
    finish(); const {latitude,longitude,accuracy} = position.coords;
    if (latitude < 40.787 || latitude > 40.809 || longitude < -77.875 || longitude > -77.850) { message('You appear to be outside this campus demo area. Choose a starting point from the list to try a route.'); return; }
    const point = [latitude,longitude], nearest = router?.nearest(point,avoidStairs);
    if (nearest && nearest.distance > 120) { message('Your location is too far from a mapped outdoor path. Choose a nearby starting point or move closer to a campus path.'); return; }
    setOrigin({id:'phone',name:'Your phone location',point});
    message(accuracy > 60 ? 'Your phone reports a broad location estimate. For a more reliable start, choose a fixed location or scan a tag.' : 'Using your phone’s current reading. Tap this button again to update it.');
  }, error => { finish(); message(error.code === 1 ? 'Location permission was not granted. You can still choose a starting point or use an NFC tag.' : 'Your phone could not get a location. Try again outside or choose a starting point.'); },{enableHighAccuracy:true,timeout:12000,maximumAge:15000});
}

$('search').addEventListener('input',renderPlaces);
document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click',() => {
  category = button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b => { const active = b === button; b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active)); }); renderPlaces();
}));
$('start-select').addEventListener('change',event => { const p = places.find(p => p.id === event.target.value); if (p) { endWalk(); message(''); setOrigin(p); } else if (event.target.value === 'phone') getLocation(); });
$('use-location').addEventListener('click',getLocation);
$('avoid-stairs').addEventListener('change',event => { avoidStairs = event.target.checked; if(walkMode==='live' && lastFix) origin.point=lastFix.point; renderRoute(); updateAddress(); });
$('back-to-places').addEventListener('click',showPlaces);
$('fit-map').addEventListener('click',()=>{if(walkMode){followLocation=false;$('recenter-map').hidden=false;}fitMap();});
$('start-walk').addEventListener('click',startWalk);
$('preview-walk').addEventListener('click',startPreview);
$('stop-walk').addEventListener('click',()=>{endWalk(); if(destination) renderRoute();});
$('previous-step').addEventListener('click',()=>{activeStep=Math.max(0,activeStep-1); renderPreview();});
$('next-step').addEventListener('click',()=>{activeStep=Math.min(walkSteps.length,activeStep+1); renderPreview();});
$('recenter-map').addEventListener('click',()=>{followLocation=true; $('recenter-map').hidden=true; if(walkMode==='preview') renderPreview(); else if(lastFix) map?.panTo(lastFix.point,{animate:false});});
window.addEventListener('pagehide',endWalk);
document.addEventListener('visibilitychange',()=>{if(document.hidden && walkMode==='live'){endWalk();message('Walk paused while the page was hidden. Press Start walk to resume live location.');}});
$('setup-open').addEventListener('click',openSetup);
$('setup-close').addEventListener('click',() => $('setup-dialog').close());
$('setup-dialog').addEventListener('click',event => { if (event.target === $('setup-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('download-tags').addEventListener('click',() => {
  const cell = value => `"${String(value).replaceAll('"','""')}"`;
  const content = [['Tag ID','Starting location','URL'],...places.map(p => [p.id,p.name,tagUrl(p.id)])].map(row => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})); const a = el('a'); a.href=url; a.download='campus-tap-nfc-links.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('NFC link list downloaded.');
});
document.addEventListener('keydown',event => { if (event.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName) && !$('setup-dialog').open) { event.preventDefault(); $('search').focus(); } });

async function init() {
  try {
    const response = await fetch('data/places.json'); if (!response.ok) throw new Error('places'); places = await response.json();
    buildSelect(); initMap(); avoidStairs = params.get('stairs') === 'avoid';
    const start = places.find(p => p.id === requestedStart) || places.find(p => p.id === 'allen-gates');
    setOrigin(start,false);
    if (requestedStart === 'phone') message('Tap “Use my location” to get a fresh location from this phone.');
    else if (requestedStart && !places.some(p => p.id === requestedStart)) message('That location link is not recognized. Choose a starting point from the list.');
    if (requestedDestination) { if (places.some(p => p.id === requestedDestination)) selectDestination(requestedDestination); else message('That destination is not part of this demo. Choose a place below.'); }
    const graphResponse = await fetch('data/walking-graph.json'); if (!graphResponse.ok) throw new Error('graph');
    router = new WalkingRouter(await graphResponse.json()); renderPlaces(); if (destination) renderRoute();
    if (location.hash === '#tags') openSetup();
  } catch (error) {
    if (places.length) { message('Campus path data could not load. Refresh to retry the walking routes.'); renderPlaces(); if (destination) renderRoute(); }
    else { $('place-list').replaceChildren(el('p','empty-state','Campus places could not load. Please refresh to try again.')); message('The campus demo is temporarily unavailable.'); }
    console.error('Campus Tap could not load its local map data.',error);
  }
}
init();
