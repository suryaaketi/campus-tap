# Campus Tap

A Penn State University Park walking guide for an ENGR 408 NFC wayfinding prototype.

Tap a programmed NFC tag to open the website at a known starting point. Choose one of eight campus and downtown destinations to see a walking route, distance and estimated time.

**Start walk** keeps the map and walking directions inside this website. Allow location access to show your position, follow your progress and update the route if you leave it. Keep the page visible. Ending the walk, arriving, changing destinations or hiding the page stops live location updates.

**Preview route** uses clearly labeled simulated positions and Previous/Next buttons, without requesting your location.

Open **NFC tag setup** on the published website to copy a starting-point URL or download all tag links. URLs preserve the GitHub Pages project path.

## Hosting

GitHub Pages: deploy from `main`, `/ (root)`. No build, backend, paid map API or API key is needed.

Map data is bundled from OpenStreetMap. See [Map data and sources](sources.html) for attribution, ODbL downloads and limitations. Leaflet's license is included under `vendor/leaflet`.

This is an independent student prototype. Routes use mapped outdoor paths; closures, indoor access and full accessibility are not verified. Live GPS accuracy still requires a physical phone walking test.
