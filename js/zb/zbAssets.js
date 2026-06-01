/**
 * zbAssets.js - Weapon GLB loader ported/adapted from ZombieBlaster (assetLoader.js)
 *
 * The ZombieBlaster weapon models are Draco-compressed, so this wires the
 * global r128 THREE.DRACOLoader (loaded in index.html) into a GLTFLoader and
 * decodes via the gstatic-hosted decoder. Weapons are static (no skinning), so
 * cloneAsset() uses a plain clone. Every load is best-effort — a failed model
 * leaves the cache slot empty and the weapon system falls back to procedural
 * placeholder geometry.
 *
 * Usage: ZBAssets.preload(onProgress) -> Promise, then ZBAssets.cloneAsset(id).
 */
(function () {
    const ASSET_MANIFEST = {
        weapon_biohazard: 'assets/Weapons/1_Neon_Biohazard_Blaste_0415181024_texture.glb',
        weapon_plasma_coil: 'assets/Weapons/2_Meshy_AI_Neon_Coil_Plasma_Rifl_0416160536_texture.glb',
        weapon_ember_blaster: 'assets/Weapons/New_Gun/3_Shotgun_futuristic.glb',
        weapon_neon_plasma_blaster: 'assets/Weapons/4_Meshy_AI_Neon_Plasma_Blaster_0416221538_texture.glb',
    };

    const assetCache = new Map();

    function buildLoader() {
        const LoaderCtor = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
            ? THREE.GLTFLoader
            : (typeof GLTFLoader !== 'undefined' ? GLTFLoader : null);
        if (!LoaderCtor) return null;

        const loader = new LoaderCtor();

        const DracoCtor = (typeof THREE !== 'undefined' && THREE.DRACOLoader)
            ? THREE.DRACOLoader
            : (typeof DRACOLoader !== 'undefined' ? DRACOLoader : null);
        if (DracoCtor) {
            try {
                const draco = new DracoCtor();
                // Google-hosted decoder matching the r128 examples DRACOLoader.
                draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
                loader.setDRACOLoader(draco);
            } catch (e) {
                console.warn('[ZBAssets] DRACOLoader setup failed; compressed weapon GLBs may not load.', e);
            }
        } else {
            console.warn('[ZBAssets] DRACOLoader not available — Draco-compressed weapon GLBs will fall back to placeholders.');
        }
        return loader;
    }

    function standardize(root) {
        root.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
    }

    // Loads every weapon GLB. Never rejects: failures resolve and leave the
    // cache slot empty. onProgress({ done, total, currentName }) drives the bar.
    function preload(onProgress) {
        const entries = Object.entries(ASSET_MANIFEST);
        const total = entries.length;
        const loader = buildLoader();

        if (!loader) {
            console.warn('[ZBAssets] No GLTFLoader available — all weapons use placeholders.');
            if (onProgress) onProgress({ done: total, total, currentName: '' });
            return Promise.resolve();
        }

        let done = 0;
        const promises = entries.map(([id, url]) => new Promise(resolve => {
            loader.load(
                url,
                gltf => {
                    standardize(gltf.scene);
                    assetCache.set(id, gltf.scene);
                    done++;
                    if (onProgress) onProgress({ done, total, currentName: id });
                    resolve();
                },
                undefined,
                err => {
                    console.warn(`[ZBAssets] Failed to load "${id}" (${url}):`, err?.message ?? err);
                    done++;
                    if (onProgress) onProgress({ done, total, currentName: id });
                    resolve();
                }
            );
        }));

        return Promise.all(promises);
    }

    function cloneAsset(id) {
        const src = assetCache.get(id);
        if (!src) return null;
        const clone = src.clone(true);
        clone.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        return clone;
    }

    window.ZBAssets = { preload, cloneAsset };
})();
