/**
 * zbVisuals.js - Visual helpers ported from ZombieBlaster (scene.js)
 *
 * Skibidi Tower uses classic global <script> tags (no ES modules), so the
 * ZombieBlaster module exports are re-exposed here as globals:
 *   ZB_COLORS, zbCreateToonMaterial(), zbCreateOutlineMesh(), zbAddOutline()
 * The weapon + effects ports below depend on these.
 */

const ZB_COLORS = {
    magenta: 0xFF00FF,
    cyan: 0x00FFFF,
    lime: 0x7FFF00,
    orange: 0xFF7F00,
    violet: 0xBF00FF,
    yellow: 0xFFFF00,
    hotPink: 0xFF1493,
    darkBg: 0x111111,
    grey: 0x555555,
    lightGrey: 0xCCCCCC,
    red: 0xFF3B30,
    green: 0x4CD964,
    white: 0xFFFFFF,
    black: 0x000000,
};

// Toon-ish matte material: low metalness, high roughness, flat shading for the
// comic-book hard-edge look.
function zbCreateToonMaterial(color, emissiveColor = 0x000000, emissiveIntensity = 0) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.0,
        emissive: emissiveColor,
        emissiveIntensity,
        flatShading: true,
    });
}

// BackSide-scaled outline mesh (2px comic outline technique).
function zbCreateOutlineMesh(geometry, scale = 1.04) {
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    const outline = new THREE.Mesh(geometry, outlineMat);
    outline.scale.multiplyScalar(scale);
    outline.renderOrder = -1;
    return outline;
}

function zbAddOutline(parent, geometry, scale = 1.05) {
    const outline = zbCreateOutlineMesh(geometry, scale);
    parent.add(outline);
    return outline;
}

window.ZB_COLORS = ZB_COLORS;
window.zbCreateToonMaterial = zbCreateToonMaterial;
window.zbCreateOutlineMesh = zbCreateOutlineMesh;
window.zbAddOutline = zbAddOutline;
