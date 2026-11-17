// Merges credits from Genius and MusicBrainz into one clean, ordered list.
import { norm } from './util.js';

export function canonRole(label) {
  const l = (label || '').toLowerCase().trim();
  if (/^feat|featuring/.test(l)) return 'Featuring';
  if (/executive/.test(l)) return 'Executive producer';
  if (/co-?produc/.test(l)) return 'Co-produced by';
  if (/additional produc/.test(l)) return 'Additional production';
  if (/produc/.test(l)) return 'Produced by';
  if (/master(ed|ing)? at/.test(l)) return 'Mastered at';
  if (/mix(ed)? at/.test(l)) return 'Mixed at';
  if (/recorded at|studio/.test(l)) return 'Recorded at';
  if (/master/.test(l)) return 'Mastered by';
  if (/mix/.test(l)) return 'Mixed by';
  if (/recording engineer|recorded by/.test(l)) return 'Recorded by';
  if (/engineer/.test(l)) return 'Engineered by';
  if (/writ|compos|lyric/.test(l)) return 'Written by';
  if (/^label/.test(l)) return 'Label';
  if (/publish/.test(l)) return 'Publisher';
  if (/distribut/.test(l)) return 'Distributor';
  return label ? label.trim().charAt(0).toUpperCase() + label.trim().slice(1) : '';
}

const ORDER = [
  'Featuring', 'Produced by', 'Co-produced by', 'Additional production', 'Executive producer', 'Written by',
  'Lead vocals', 'Vocals', 'Background vocals', '*', 'Programming', 'Arranged by', 'Recorded by',
  'Engineered by', 'Mixed by', 'Mastered by', 'Recorded at', 'Mixed at', 'Mastered at', 'Label',
  'Publisher', 'Distributor',
];

function rank(role) {
  const i = ORDER.indexOf(role);
  return i === -1 ? ORDER.indexOf('*') : i;
}

const PLACE_ROLES = new Set(['Recorded at', 'Mixed at', 'Mastered at']);

export function mergeCredits(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const entry of list || []) {
      const role = canonRole(entry.role);
      if (!role) continue;
      if (!map.has(role)) map.set(role, { role, kind: PLACE_ROLES.has(role) ? 'place' : entry.kind || 'artist', people: [] });
      const bucket = map.get(role);
      for (const p of entry.people || []) {
        const ex = bucket.people.find((x) => norm(x.name) === norm(p.name));
        if (ex) {
          ex.geniusId = ex.geniusId || p.geniusId;
          ex.mbid = ex.mbid || p.mbid;
          ex.mbPlaceId = ex.mbPlaceId || p.mbPlaceId;
        } else bucket.people.push({ ...p });
      }
    }
  }
  return [...map.values()].filter((r) => r.people.length).sort((a, b) => rank(a.role) - rank(b.role));
}
