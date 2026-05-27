// ============================================
// Skibidi Tower ⇄ Three.js editor bridge
// Loaded dynamically by editor/js/Menubar.File.js when the user clicks
// "Import Level" or "Save Level". Runs in the editor's page context, so
// the editor's importmap is in scope:
//   three            -> ../build/three.module.js
//   three/addons/    -> ../examples/jsm/
// ============================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const SAVE_FILENAME = 'levelData.json';
const DEFAULT_KIT_FOLDER = 'props';

// Visual marker colors for editor-only objects.
const ARENA_COLOR = 0x00aaff;
const BASE_COLOR = 0xaaaaaa;
const ENEMY_SPAWN_COLOR = 0xff0044;
const PLAYER_SPAWN_COLOR = 0x00ffff;
const LIGHT_HELPER_OPACITY = 0.6;

// Match the rounding used by the runtime so save → load → save is byte-stable.
const round = n => Math.round(n * 10000) / 10000;

async function fetchAssetKitMap() {
    try {
        const resp = await fetch('/api/asset-kits', { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.warn('[skibidi-tower-level] /api/asset-kits failed, falling back to default kit:', e);
        return {};
    }
}

function assetUrl(kitMap, filename) {
    const kit = kitMap[filename] ?? DEFAULT_KIT_FOLDER;
    return `/assets/${kit}/${filename}`;
}

function cloneAsset(source) {
    let isSkinned = false;
    source.traverse(c => { if (c.isSkinnedMesh) isSkinned = true; });
    return isSkinned ? cloneSkinned(source) : source.clone(true);
}

// Belt-and-braces autosave neutralisation. The Three.js editor's autosave
// runs editor.toJSON() and writes the result to IndexedDB on every signal-
// driven scene change, which freezes the main thread on big GLB scenes. We
// flip the autosave config flag, stub editor.toJSON(), and stub storage.set
// — originals stash on editor._stOriginal* so you can restore them via
// devtools if you want the editor's native Save Project flow back.
function neutraliseAutosave(editor) {
    if (editor.config?.setKey) {
        editor.config.setKey('autosave', false);
    }
    if (typeof editor.toJSON === 'function' && !editor._stOriginalToJSON) {
        editor._stOriginalToJSON = editor.toJSON.bind(editor);
        editor.toJSON = function () {
            return {
                metadata: { type: 'App', version: 4, generator: 'three.js editor (skibidi-tower stub)' },
                project: {}, camera: {}, scene: { type: 'Scene' },
                scripts: {}, history: { undos: [], redos: [] },
            };
        };
    }
    if (editor.storage?.set && !editor.storage._stOriginalSet) {
        editor.storage._stOriginalSet = editor.storage.set.bind(editor.storage);
        editor.storage.set = function () { /* no-op */ };
    }
}

// Decompose a node's WORLD matrix into (position, Euler XYZ, scale). Saving
// world-space — not local — means a prop dragged into a Group in the editor's
// outliner still serialises at the position the user sees: the game has no
// equivalent grouping, so a local-space save would land the prop at `local`
// and visually jump by `parent.matrixWorld`.
const _wPos = new THREE.Vector3();
const _wQuat = new THREE.Quaternion();
const _wScale = new THREE.Vector3();
const _wEuler = new THREE.Euler();
function worldTransformOf(node) {
    node.updateMatrixWorld(true);
    node.matrixWorld.decompose(_wPos, _wQuat, _wScale);
    _wEuler.setFromQuaternion(_wQuat, 'XYZ');
    return {
        x: _wPos.x, y: _wPos.y, z: _wPos.z,
        rx: _wEuler.x, ry: _wEuler.y, rz: _wEuler.z,
        sx: _wScale.x, sy: _wScale.y, sz: _wScale.z,
    };
}

export async function importLevel(editor) {
    neutraliseAutosave(editor);

    // 1. Pull the level JSON.
    let level;
    try {
        const resp = await fetch('/data/levelData.json', { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        level = await resp.json();
    } catch (e) {
        alert(`Failed to load levelData.json: ${e.message}`);
        return;
    }

    // 2. Pre-load every GLB referenced by customProps (in parallel).
    const kitMap = await fetchAssetKitMap();
    const uniqueAssets = [...new Set((level.customProps ?? []).map(p => p.asset))];
    const loader = new GLTFLoader();
    const cache = new Map();

    const origTitle = document.title;
    let done = 0;
    if (uniqueAssets.length > 0) {
        document.title = `Importing 0/${uniqueAssets.length}…`;
    }

    await Promise.all(uniqueAssets.map(async asset => {
        try {
            const gltf = await loader.loadAsync(assetUrl(kitMap, asset));
            cache.set(asset, gltf.scene);
        } catch (e) {
            console.warn(`[skibidi-tower-level] failed to load ${asset}:`, e);
        } finally {
            done++;
            document.title = `Importing ${done}/${uniqueAssets.length}…`;
        }
    }));

    document.title = origTitle;

    // 3. Wipe the editor scene and drop our entities in.
    editor.clear();
    const scene = editor.scene;

    // Stash the original version so a round-trip preserves it. waves is
    // game logic with no visual representation — round-trip without editing.
    scene.userData.skibidiTowerUnmapped = {
        version: level.version ?? 1,
        waves: level.waves ?? [],
    };

    // Arena — wireframe box at the centre of the playable area.
    const arena = level.arena ?? { size: 40, wallHeight: 5 };
    {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(arena.size, arena.wallHeight, arena.size),
            new THREE.MeshBasicMaterial({ color: ARENA_COLOR, wireframe: true })
        );
        mesh.position.set(0, arena.wallHeight / 2, 0);
        mesh.name = 'Arena';
        mesh.userData = { kind: 'arena' };
        editor.addObject(mesh);
    }

    // Defense base — gray cylinder placeholder so the designer can see where
    // the tower sits. Resizing the cylinder updates the base's footprint /
    // height on save.
    const base = level.base ?? { x: 0, y: 0, z: 0, maxHealth: 100, radius: 2.5, height: 6.5 };
    {
        const radius = base.radius ?? 2.5;
        const height = base.height ?? 6.5;
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.8, radius, height, 8),
            new THREE.MeshBasicMaterial({ color: BASE_COLOR, wireframe: true })
        );
        mesh.position.set(base.x ?? 0, (base.y ?? 0) + height / 2, base.z ?? 0);
        mesh.name = 'Defense Base';
        mesh.userData = { kind: 'base', maxHealth: base.maxHealth ?? 100 };
        editor.addObject(mesh);
    }

    // Player spawn — cyan octahedron at the tower top.
    const ps = level.playerSpawn ?? { x: 0, y: 8.2, z: 0 };
    {
        const mesh = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.6),
            new THREE.MeshLambertMaterial({ color: PLAYER_SPAWN_COLOR })
        );
        mesh.position.set(ps.x, ps.y, ps.z);
        mesh.name = 'Player Spawn';
        mesh.userData = { kind: 'playerSpawn' };
        editor.addObject(mesh);
    }

    // Enemy spawns — red icosahedrons around the perimeter at y=0. Schema
    // stores only x/z (game places them at ground level), so the editor's
    // y can be authored for visibility but is dropped on save.
    for (const s of level.enemySpawns ?? []) {
        const mesh = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.6),
            new THREE.MeshLambertMaterial({ color: ENEMY_SPAWN_COLOR })
        );
        mesh.position.set(s.x, 0.6, s.z);
        mesh.name = `Enemy Spawn: ${s.id}`;
        mesh.userData = { kind: 'enemySpawn', id: s.id };
        editor.addObject(mesh);
    }

    // Lights — PointLights with a wireframe-sphere child marker so they're
    // easy to click in the viewport. The marker is tagged so saveLevel's
    // traversal skips it.
    for (const l of level.lights ?? []) {
        const colorInt = typeof l.color === 'string'
            ? parseInt(l.color.replace(/^0x/i, ''), 16)
            : l.color;
        const light = new THREE.PointLight(colorInt, l.intensity ?? 1, l.distance ?? 0);
        light.position.set(l.x ?? 0, l.y ?? 0, l.z ?? 0);
        light.name = `Light: ${l.id}`;
        light.userData = { kind: 'light', id: l.id };

        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 12, 12),
            new THREE.MeshBasicMaterial({
                color: colorInt, wireframe: true,
                transparent: true, opacity: LIGHT_HELPER_OPACITY,
            })
        );
        marker.name = 'light-helper';
        light.add(marker);

        editor.addObject(light);
    }

    // Custom props — real GLBs cloned from the cache.
    for (const p of level.customProps ?? []) {
        const source = cache.get(p.asset);
        if (!source) {
            console.warn(`[skibidi-tower-level] no GLB cached for ${p.asset}; skipping ${p.id}`);
            continue;
        }
        const node = cloneAsset(source);
        node.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
        node.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
        if (typeof p.sx === 'number' || typeof p.sy === 'number' || typeof p.sz === 'number') {
            node.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
        } else {
            node.scale.setScalar(p.scale ?? 1);
        }
        node.name = `Prop: ${p.id} [${p.asset}]`;
        node.userData = { kind: 'customProp', id: p.id, asset: p.asset };
        editor.addObject(node);
    }

    console.log(
        `[skibidi-tower-level] imported ` +
        `${level.enemySpawns?.length ?? 0} enemy spawn(s), ` +
        `${level.lights?.length ?? 0} light(s), ` +
        `${level.customProps?.length ?? 0} custom prop(s). ` +
        `Autosave neutralised — use File → Save Level to persist.`
    );
}

// Top-level children imported via the editor's File → Import (Loader.js sets
// scene.name = filename and adds without any userData.kind) are invisible to
// the customProp traversal below. Promote any matching node to a customProp
// here so the user's GLB drops actually persist into levelData.json.
function autoTagUntaggedProps(editor) {
    const existingIds = new Set();
    editor.scene.traverse(node => {
        if (node.userData?.id) existingIds.add(node.userData.id);
    });

    let counter = 0;
    const nextId = () => {
        let id;
        do { id = `custom_${counter++}`; } while (existingIds.has(id));
        existingIds.add(id);
        return id;
    };

    let tagged = 0;
    for (const child of editor.scene.children) {
        if (child.userData?.kind) continue;
        if (child.isLight || child.isCamera) continue;
        const m = (child.name || '').match(/([^/\\]+\.(?:glb|gltf))$/i);
        if (!m) continue;
        const asset = m[1];
        child.userData = {
            ...(child.userData || {}),
            kind: 'customProp',
            id: nextId(),
            asset,
        };
        tagged++;
    }
    if (tagged > 0) {
        console.log(`[skibidi-tower-level] auto-tagged ${tagged} imported GLB prop(s) for save`);
    }
}

function buildLevelJson(editor) {
    autoTagUntaggedProps(editor);

    const unmapped = editor.scene.userData?.skibidiTowerUnmapped ?? {};
    const out = {
        version: unmapped.version ?? 1,
        arena: { size: 40, wallHeight: 5 },
        base: { x: 0, y: 0, z: 0, maxHealth: 100, radius: 2.5, height: 6.5 },
        playerSpawn: { x: 0, y: 8.2, z: 0 },
        enemySpawns: [],
        waves: unmapped.waves ?? [],
        lights: [],
        customProps: [],
    };

    editor.scene.traverse(node => {
        const k = node.userData?.kind;
        if (!k) return;

        if (k === 'arena') {
            // BoxGeometry stores authored size on .parameters; editor resize
            // lands on .scale, so multiply. Width and depth round to the
            // same value (the runtime treats the arena as square).
            const params = node.geometry?.parameters ?? { width: 40, height: 5, depth: 40 };
            out.arena = {
                size: round(params.width * node.scale.x),
                wallHeight: round(params.height * node.scale.y),
            };
        } else if (k === 'base') {
            const params = node.geometry?.parameters ?? { radiusTop: 2, radiusBottom: 2.5, height: 6 };
            const height = round(params.height * node.scale.y);
            out.base = {
                x: round(node.position.x),
                y: round(node.position.y - height / 2),
                z: round(node.position.z),
                maxHealth: node.userData.maxHealth ?? 100,
                radius: round(params.radiusBottom * node.scale.x),
                height,
            };
        } else if (k === 'playerSpawn') {
            out.playerSpawn = {
                x: round(node.position.x),
                y: round(node.position.y),
                z: round(node.position.z),
            };
        } else if (k === 'enemySpawn') {
            out.enemySpawns.push({
                id: node.userData.id,
                x: round(node.position.x),
                z: round(node.position.z),
            });
        } else if (k === 'light') {
            out.lights.push({
                id: node.userData.id,
                x: round(node.position.x),
                y: round(node.position.y),
                z: round(node.position.z),
                color: '0x' + node.color.getHexString().toUpperCase(),
                intensity: node.intensity,
                distance: node.distance,
            });
        } else if (k === 'customProp') {
            if (node.parent && node.parent !== editor.scene) {
                console.warn(
                    `[skibidi-tower-level] prop "${node.userData.id}" (${node.userData.asset}) is nested under ` +
                    `"${node.parent.name || node.parent.type}"; saving its world-space transform.`
                );
            }
            const w = worldTransformOf(node);
            const prop = {
                id: node.userData.id,
                asset: node.userData.asset,
                x: round(w.x),
                y: round(w.y),
                z: round(w.z),
            };
            if (w.rx) prop.rx = round(w.rx);
            if (w.ry) prop.ry = round(w.ry);
            if (w.rz) prop.rz = round(w.rz);
            const sx = round(w.sx);
            const sy = round(w.sy);
            const sz = round(w.sz);
            if (sx === sy && sx === sz) {
                prop.scale = sx;
            } else {
                prop.sx = sx;
                prop.sy = sy;
                prop.sz = sz;
            }
            out.customProps.push(prop);
        }
    });

    return out;
}

// Menubar.File → "Save Level". POSTs the level JSON to /api/save-level so
// the dev server writes data/levelData.json in place — reload the game tab
// to see the change.
export async function saveLevel(editor) {
    let out;
    try {
        out = buildLevelJson(editor);
    } catch (e) {
        alert(`Save failed: ${e.message}`);
        console.error(e);
        return;
    }

    try {
        const resp = await fetch('/api/save-level', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(out, null, 2),
        });
        let body = null;
        try { body = await resp.json(); } catch (_) { /* ignore body parse */ }
        if (!resp.ok || (body && body.ok === false)) {
            const detail = body?.detail || body?.error || `HTTP ${resp.status}`;
            throw new Error(detail);
        }
        alert(
            `Saved to game (data/${SAVE_FILENAME}): ` +
            `${out.enemySpawns.length} spawn(s), ${out.lights.length} light(s), ` +
            `${out.customProps.length} prop(s).\n\n` +
            `Reload the game tab to play the updated level.`
        );
    } catch (e) {
        alert(`Save to game failed: ${e.message}`);
        console.error(e);
    }
}

// Editor's File → Save funnels through here. Downloads a snapshot to the
// browser's default downloads folder without overwriting the live level.
export async function saveLevelToDownloads(editor) {
    let out;
    try {
        out = buildLevelJson(editor);
    } catch (e) {
        alert(`Download failed: ${e.message}`);
        console.error(e);
        return;
    }

    const text = JSON.stringify(out, null, 2);
    const blob = new Blob([text], { type: 'application/json' });

    if (typeof editor?.utils?.save === 'function') {
        editor.utils.save(blob, SAVE_FILENAME);
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = SAVE_FILENAME;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    alert(
        `Downloaded ${SAVE_FILENAME}: ` +
        `${out.enemySpawns.length} spawn(s), ${out.lights.length} light(s), ` +
        `${out.customProps.length} prop(s).\n\n` +
        `Drop the file into data/ to replace the live level, or use File → Save Level to write it directly.`
    );
}
