# Campus Tap

A Penn State University Park walking guide for an ENGR 408 NFC wayfinding prototype.

Tap a programmed NFC tag to open the website at a known starting point. Choose one of eight campus and downtown destinations to see a walking route, distance and estimated time.

**Start walk** keeps the map and walking directions inside this website. Allow location access to show your position, follow your progress and update the route if you leave it. Keep the page visible. Ending the walk, arriving, changing destinations or hiding the page stops live location updates.

During a walk, a cone on the position dot shows which way the phone points. The map stays north-up. On iPhone, allow Motion & Orientation access when asked; if the compass is unavailable, the cone follows your GPS direction of travel once you are walking.

**Preview route** uses clearly labeled simulated positions and Previous/Next buttons, without requesting your location.

Open **NFC tag setup** on the published website to copy a starting-point URL or download all tag links. URLs preserve the GitHub Pages project path.

## Hosting

GitHub Pages: deploy from `main`, `/ (root)`. No build, backend, paid map API or API key is needed.

Map data is bundled from OpenStreetMap. See [Map data and sources](sources.html) for attribution, ODbL downloads and limitations. Leaflet's license is included under `vendor/leaflet`.

This is an independent student prototype. Routes use mapped outdoor paths; closures, indoor access and full accessibility are not verified. Live GPS accuracy still requires a physical phone walking test.

## NFC signs and technical-test evidence

Open **NFC tag setup → Print NFC / QR signs and record prototype tests**, or go to `tools.html`.

* Choose a real tag location, copy its URL, and write it to a writable NFC tag. Prepare the matching QR sign from the published website.
* Run the eight website checks. These cover map-file loading, link validation and 128 walking-route combinations, including the stairs setting.
* Perform phone trials and record the actual device/OS, outcome, optional elapsed seconds, issues, fixes and evidence filenames. NFC and GPS hardware results must be observed on real devices.
* Export the phone-test CSV and full JSON report before changing devices or clearing browser data. Records stay in the browser. Removal has an Undo control.
* Automated website checks and observed phone trials have distinct fields in the report. A new test log starts empty.

QR graphics are generated locally using Kazuhiko Arase's MIT-licensed qrcode-generator. Its license is included under `vendor/qrcode`.

## Automated development checks

With Node.js installed, run `npm test`. No package installation is needed. The tests cover routes, navigation progress, location-watch cleanup, tag-link validation and test-report records.

Before editing locally, run `git pull --ff-only`. Edit the website files at the repository root, then commit and push to `main` to update GitHub Pages.
