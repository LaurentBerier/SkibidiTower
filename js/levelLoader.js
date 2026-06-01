/**
 * levelLoader.js - Fetch and normalise data/levelData.json
 *
 * The game can run with or without a level file. When fetch fails (e.g. the
 * file is missing, opened from file:// without a server, or hit a network
 * error), DEFAULT_LEVEL is returned so the original hardcoded behaviour
 * still works. When the file loads, missing fields are backfilled from the
 * defaults so partial level files don't crash the game.
 */

const DEFAULT_LEVEL = {
    version: 1,
    arena: { size: 40, wallHeight: 5 },
    base: { x: 0, y: 0, z: 0, maxHealth: 100, radius: 2.5, height: 6.5 },
    enemyTower: { x: 0, y: 0, z: -16, radius: 5, height: 17 },
    playerSpawn: { x: 0, y: 1.7, z: 0 },
    enemySpawns: [], // empty = game falls back to random perimeter spawns
    waves: [],
    lights: [],
    customProps: [],
};

class LevelLoader {
    static async load(url = 'data/levelData.json') {
        try {
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            console.log('Level data loaded:', url);
            return LevelLoader._merge(DEFAULT_LEVEL, data);
        } catch (e) {
            console.warn(`Could not load ${url} (${e.message}); using defaults.`);
            return LevelLoader._merge(DEFAULT_LEVEL, {});
        }
    }

    // Shallow-merge with one level of object-merge for nested config
    // sections (arena, base, playerSpawn). Arrays replace wholesale.
    static _merge(defaults, override) {
        const out = { ...defaults, ...override };
        for (const key of ['arena', 'base', 'enemyTower', 'playerSpawn']) {
            out[key] = { ...defaults[key], ...(override[key] ?? {}) };
        }
        return out;
    }
}

window.LevelLoader = LevelLoader;
window.DEFAULT_LEVEL = DEFAULT_LEVEL;
