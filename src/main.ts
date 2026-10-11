import './style.css';
import { Fleet } from './fleet';
import { bboxAround, createProjection, roundLatLon } from './geo';
import { resolvePosition } from './location';
import { Poller, type PollStatus } from './poller';
import { Scene } from './render/scene';
import { resolveSource } from './sources/registry';
import { TrailIndex } from './trailIndex';
import type { BBox } from './types';
import { Ui, loadPrefs, persistenceSeconds } from './ui';

const canvas = document.getElementById('chamber') as HTMLCanvasElement;
const prefs = loadPrefs();
const scene = new Scene(canvas, persistenceSeconds(prefs), prefs.radiusKm * 1000);
scene.setPersistence(persistenceSeconds(prefs));

const { source, error: sourceError } = resolveSource(location.search);
let fleet = new Fleet(createProjection({ lat: 0, lon: 0 }));
let poller: Poller | null = null;
let status: PollStatus | null = null;
let hasPosition = false;
let paused = false;
/** gerundete Position (nur diese verlässt den Browser) und daraus die Abfragebox */
let queryCenter: { lat: number; lon: number } | null = null;
let bbox: BBox | null = null;
const updateBBox = () => {
  if (queryCenter) bbox = bboxAround(queryCenter, prefs.radiusKm * 1000, 3);
};

// Spurverlauf für das Zeigen mit Maus/Finger; die Spur-Uhr läuft nur, wenn die Animation läuft
const trailIndex = new TrailIndex();
let trailClock = 0;
let frameNo = 0;
/** Alter, bis zu dem eine Spur noch als sichtbar gilt (bei 100 % Nachleuchten ≈ 5 % Helligkeit) */
const visibleAge = () => scene.fader.persistenceSec * 1000 * 0.8;
let pointer: { x: number; y: number; touch: boolean; moved: boolean } | null = null;
let pointerTimer: ReturnType<typeof setTimeout> | null = null;
let lastQuery = 0;

const ui = new Ui(prefs, {
  onPersistence: (sec) => scene.setPersistence(sec),
  onRadiusInput: (km) => scene.setRadius(km * 1000),
  onRadiusChange: () => {
    updateBBox();
    // neuen Bereich bald laden, aber nicht öfter als alle 8 s
    poller?.requestSoon(8_000);
  },
  onPause: (p) => {
    paused = p;
    if (p) poller?.stop();
    else {
      // nach der Pause keine langen Striche über die verpasste Strecke ziehen
      for (const tv of fleet.vehicles.values()) tv.broken = true;
      if (!document.hidden) poller?.start();
    }
  },
});
ui.setAttribution(source);
if (sourceError) ui.showNotice(sourceError, 0);
if (source?.simulated) ui.showNotice('Demo-Modus mit simulierten Fahrzeugen.', 6000);

// --- Größe und Animation -------------------------------------------------
scene.resize();
new ResizeObserver(() => scene.resize()).observe(canvas);
// devicePixelRatio ändert sich z. B. beim Verschieben auf einen anderen Monitor
(function watchDpr() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      scene.resize();
      watchDpr();
    },
    { once: true },
  );
})();

let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(t - last, 100);
  last = t;
  const now = Date.now();
  try {
    if (!paused) {
      fleet.step(now, dt);
      trailClock += dt;
      // vor dem Rendern, weil der Spur-Renderer das broken-Flag zurücksetzt
      // Punkte etwa alle 3 Bildschirmpixel speichern, mindestens alle 12 m
      trailIndex.minStep = Math.max(12, 3 / scene.scale);
      trailIndex.update(fleet.vehicles.values(), trailClock, now);
      if (++frameNo % 30 === 0) trailIndex.prune(trailClock, visibleAge());
    }
    updatePointer();
    scene.render(fleet, now, dt, !paused, hasPosition);
  } catch (e) {
    // ein fehlerhafter Frame darf die Animation nicht beenden
    console.error(e);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Zeigen auf Spuren -----------------------------------------------------
function updatePointer(): void {
  if (!pointer) {
    scene.highlight = null;
    ui.showTip(null);
    return;
  }
  // Suche nur bei Bewegung oder alle 300 ms – bei langen Spuren sind das viele Punkte
  const t = performance.now();
  if (!pointer.moved && t - lastQuery < 300) return;
  pointer.moved = false;
  lastQuery = t;
  const p = scene.toLocal(pointer.x, pointer.y);
  const radiusPx = pointer.touch ? 22 : 10;
  const hit = trailIndex.nearest(p.x, p.y, radiusPx / scene.scale, trailClock, visibleAge(), Date.now());
  canvas.style.cursor = hit ? 'pointer' : '';
  if (!hit) {
    scene.highlight = null;
    ui.showTip(null);
    return;
  }
  scene.highlight = {
    mode: hit.meta.mode,
    runs: trailIndex.path(hit.meta.id, trailClock, visibleAge()),
    head: hit.head,
    active: hit.active,
  };
  ui.showTip(
    { mode: hit.meta.mode, line: hit.meta.line, direction: hit.meta.direction, active: hit.active, ageSec: Math.round(hit.wallAge / 1000) },
    pointer.x,
    pointer.y,
  );
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  pointer = { x: e.clientX, y: e.clientY, touch: false, moved: true };
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') pointer = null;
});
// Auf Touch-Geräten: Antippen zeigt die Spur für einige Sekunden
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  pointer = { x: e.clientX, y: e.clientY, touch: true, moved: true };
  if (pointerTimer) clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => (pointer = null), 4000);
});

// Zugriff für die Fehlersuche, nur im Entwicklungsmodus
if (import.meta.env.DEV) Object.assign(window, { __fleet: () => fleet, __scene: scene, __trails: trailIndex });

setInterval(() => ui.renderStatus(source, status, Date.now(), hasPosition ? undefined : 'Standort wird ermittelt …'), 1000);
ui.renderStatus(source, status, Date.now(), 'Standort wird ermittelt …');

// --- Standort und Polling ------------------------------------------------
void (async () => {
  const resolved = await resolvePosition(location.search);
  if (resolved.note) ui.showNotice(resolved.note, 10_000);
  // Die exakte Position bleibt im Browser (Projektion); die Abfrage nutzt nur gerundete Koordinaten.
  fleet = new Fleet(createProjection(resolved.pos));
  hasPosition = true;
  queryCenter = roundLatLon(resolved.pos, 3);
  updateBBox();
  if (!source) return;

  poller = new Poller(
    source,
    () => bbox!,
    (vehicles) => fleet.ingest(vehicles, Date.now()),
    (s) => {
      status = s;
    },
  );
  if (!paused && !document.hidden) poller.start();

  // im Hintergrund nicht abfragen
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) poller?.stop();
    else if (!paused) {
      for (const tv of fleet.vehicles.values()) tv.broken = true;
      poller?.start();
    }
  });
})();
