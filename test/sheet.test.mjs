import test from 'node:test';
import assert from 'node:assert/strict';
import {detentOffsets,nearestDetent} from '../sheet.js';

test('sheet heights keep the important part visible and stay in order',()=>{
  const o=detentOffsets(800,220);
  assert.equal(o.peek,800-220); assert.equal(o.large,52);
  assert.ok(o.large<o.medium && o.medium<=o.peek);
  // A tall route card is capped so some map always shows above it.
  const tall=detentOffsets(700,900);
  assert.ok(700-tall.peek<=700*0.7+1); assert.ok(tall.medium<=tall.peek);
  assert.equal(detentOffsets(700,10).peek,700-120);
});

test('a released drag settles on the nearest height, carried by a flick',()=>{
  const o={large:52,medium:350,peek:580};
  assert.equal(nearestDetent(o,340),'medium');
  assert.equal(nearestDetent(o,90),'large');
  assert.equal(nearestDetent(o,340,2),'peek');      // flicked down
  assert.equal(nearestDetent(o,340,-2),'large');    // flicked up
});
