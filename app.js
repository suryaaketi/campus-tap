import { WalkingRouter, metersBetween } from './router.js';

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
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.pin}</svg>`;
const $ = id => document.getElementById(id);
function el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function symbol(name, className = '') { const e = el('span',className); e.innerHTML = icon(name); return e; }
document.querySelectorAll('[data-icon]').forEach(e => { e.innerHTML = icon(e.dataset.icon); });

let places = [], router, origin, destination = null, category = 'all', map, routeLayer, startMarker;
let markers = new Map(), routeCache = new Map(), currentRoute = null, toastTimer, loadVersion = 0;
let avoidStairs = false, locationReading = false;
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
  $('origin-context').textContent = place.id === 'phone' ? 'From your phone’s last location reading.' : requestedStart === place.id ? 'Starting point supplied by this location link.' : 'Your route starts at this mapped location.';
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
    $('map-status').textContent = 'The map background could not load. Route steps and Google Maps directions are still available.'; $('map-status').hidden = false;
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
  destination = p;
  $('places').hidden = true; $('route-view').hidden = false;
  renderRoute(); updateAddress();
  if (matchMedia('(max-width:700px)').matches) $('route-view').scrollIntoView({behavior:'smooth',block:'start'});
  else document.querySelector('.finder').scrollTo({top:0,behavior:'smooth'});
}
function showPlaces() {
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
  const maps = new URL('https://www.google.com/maps/dir/');
  maps.searchParams.set('api','1'); maps.searchParams.set('origin',origin.point.join(',')); maps.searchParams.set('destination',destination.point.join(',')); maps.searchParams.set('travelmode','walking');
  $('maps-link').href = maps.href;
  currentRoute = routeFor(destination);
  $('route-steps').replaceChildren();
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  $('route-summary').hidden = !currentRoute;
  $('route-state').textContent = !router ? 'Loading the campus walking paths…' : !currentRoute ? 'No mapped route is available with this starting point and setting. Try another starting point or open Google Maps for walking directions.' : currentRoute.hasStairs ? 'This route includes mapped stairs.' : '';
  $('map-heading').textContent = destination.name; $('map-description').textContent = `Walking from ${origin.name}`;
  if (currentRoute) {
    $('route-minutes').textContent = `${currentRoute.minutes} min`; $('route-distance').textContent = formatDistance(currentRoute.distance);
    const steps = router.instructions(currentRoute);
    if (currentRoute.startSnap.distance > 12) addStep('Join the highlighted outdoor path near your starting point.',formatDistance(currentRoute.startSnap.distance));
    for (const step of steps) addStep(step.text,formatDistance(step.distance));
    addStep(`Arrive near ${destination.name}`,destination.id === 'downtown-food' ? 'Dining area around College Avenue and Allen Street' : 'Follow signs to the entrance','arrival');
    $('step-count').textContent = `${$('route-steps').children.length} steps`;
    if (map) {
      routeLayer = L.featureGroup([
        L.polyline(currentRoute.points,{color:'#fff',weight:9,opacity:.95,lineCap:'round'}),
        L.polyline(currentRoute.points,{color:'#254f7d',weight:5,opacity:1,lineCap:'round'})
      ]).addTo(map);
    }
  } else $('step-count').textContent = '';
  updateMarkers(); fitMap();
}
function addStep(text,distance,className='') {
  const item = el('li',className); item.append(el('span','',text),el('small','',distance)); $('route-steps').append(item);
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
$('start-select').addEventListener('change',event => { const p = places.find(p => p.id === event.target.value); if (p) { message(''); setOrigin(p); } else if (event.target.value === 'phone') getLocation(); });
$('use-location').addEventListener('click',getLocation);
$('avoid-stairs').addEventListener('change',event => { avoidStairs = event.target.checked; renderRoute(); updateAddress(); });
$('back-to-places').addEventListener('click',showPlaces);
$('fit-map').addEventListener('click',fitMap);
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
    if (places.length) { message('Campus path data could not load. Choose a destination to open Google Maps walking directions, or refresh to try again.'); renderPlaces(); if (destination) renderRoute(); }
    else { $('place-list').replaceChildren(el('p','empty-state','Campus places could not load. Please refresh to try again.')); message('The campus demo is temporarily unavailable.'); }
    console.error('Campus Tap could not load its local map data.',error);
  }
}
init();
