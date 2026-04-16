// Shared constants across the kiosk system

export const FLOOR_HEIGHT = 4.0;       // world-units per floor (walls + ceiling)
export const FLOOR_THICKNESS = 0.3;    // slab thickness
export const ACCORDION_GAP = 3.5;      // extra separation in accordion mode

export const KioskState = Object.freeze({
  IDLE:     'idle',      // attract screen
  LOCATING: 'locating',  // resolving user position
  BROWSING: 'browsing',  // free exploration
  ROUTING:  'routing',   // path displayed
  FOCUSED:  'focused',   // zoomed to destination
});

// Demo waypoint graph (production: loaded from CMS / BIM export)
export const DEMO_GRAPH = {
  nodes: {
    'entrance':   { id: 'entrance',   label: 'Main Entrance', floor: 0, pos: [ 0,   0,    7  ] },
    'info':       { id: 'info',       label: 'Info Desk',     floor: 0, pos: [-3,   0,    3  ] },
    'shop-a':     { id: 'shop-a',     label: 'Store A',       floor: 0, pos: [-7,   0,   -2  ] },
    'shop-b':     { id: 'shop-b',     label: 'Store B',       floor: 0, pos: [ 7,   0,   -2  ] },
    'elev-0':     { id: 'elev-0',     label: 'Elevator L0',   floor: 0, pos: [ 0,   0,   -6  ] },
    'food-court': { id: 'food-court', label: 'Food Court',    floor: 1, pos: [ 0,   4.3,  3  ] },
    'shop-c':     { id: 'shop-c',     label: 'Store C',       floor: 1, pos: [-7,   4.3, -2  ] },
    'shop-d':     { id: 'shop-d',     label: 'Store D',       floor: 1, pos: [ 7,   4.3, -2  ] },
    'elev-1':     { id: 'elev-1',     label: 'Elevator L1',   floor: 1, pos: [ 0,   4.3, -6  ] },
    'cinema':     { id: 'cinema',     label: 'Cinema',        floor: 2, pos: [-5,   8.6, -1  ] },
    'gym':        { id: 'gym',        label: 'Gym',           floor: 2, pos: [ 5,   8.6, -1  ] },
    'lounge':     { id: 'lounge',     label: 'Sky Lounge',    floor: 2, pos: [ 0,   8.6,  4  ] },
    'elev-2':     { id: 'elev-2',     label: 'Elevator L2',   floor: 2, pos: [ 0,   8.6, -6  ] },
    'office-a':   { id: 'office-a',   label: 'Office Suite A',floor: 3, pos: [-6,  12.9, -2  ] },
    'office-b':   { id: 'office-b',   label: 'Office Suite B',floor: 3, pos: [ 6,  12.9, -2  ] },
    'rooftop':    { id: 'rooftop',    label: 'Rooftop Garden',floor: 3, pos: [ 0,  12.9,  3  ] },
    'elev-3':     { id: 'elev-3',     label: 'Elevator L3',   floor: 3, pos: [ 0,  12.9, -6  ] },
  },
  edges: [
    // Floor 0 connections
    ['entrance', 'info',     1.5],
    ['info',     'shop-a',   2.0],
    ['info',     'shop-b',   2.0],
    ['info',     'elev-0',   2.5],
    // Vertical elevator connections
    ['elev-0',   'elev-1',   1.0],
    ['elev-1',   'elev-2',   1.0],
    ['elev-2',   'elev-3',   1.0],
    // Floor 1 connections
    ['elev-1',   'food-court', 1.5],
    ['elev-1',   'shop-c',     2.0],
    ['elev-1',   'shop-d',     2.0],
    // Floor 2 connections
    ['elev-2',   'cinema',  2.0],
    ['elev-2',   'gym',     2.0],
    ['elev-2',   'lounge',  1.5],
    // Floor 3 connections
    ['elev-3',   'office-a', 2.0],
    ['elev-3',   'office-b', 2.0],
    ['elev-3',   'rooftop',  1.5],
  ],
};

export const DEMO_BEACONS = [
  { id: 'b-0-nw', floor: 0, x: -9, z:  7, txPower: -65 },
  { id: 'b-0-ne', floor: 0, x:  9, z:  7, txPower: -65 },
  { id: 'b-0-s',  floor: 0, x:  0, z: -7, txPower: -65 },
  { id: 'b-1-nw', floor: 1, x: -9, z:  7, txPower: -65 },
  { id: 'b-1-ne', floor: 1, x:  9, z:  7, txPower: -65 },
  { id: 'b-1-s',  floor: 1, x:  0, z: -7, txPower: -65 },
  { id: 'b-2-nw', floor: 2, x: -9, z:  7, txPower: -65 },
  { id: 'b-2-c',  floor: 2, x:  0, z:  0, txPower: -65 },
];
