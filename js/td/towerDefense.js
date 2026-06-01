/**
 * towerDefense.js — Tower-defense layer for Skibidi Tower.
 *
 * Adds a classic top-down tower-defense loop on top of the FPS game:
 *   • Turret      — an auto-targeting gun emplacement that shoots nearby enemies.
 *   • TurretSystem — owns/updates all placed turrets and their tracers.
 *   • CoinSystem  — gold coins dropped by dying Skibidi; collected on foot (FPS).
 *   • BuildController — the iso "overwatch" camera + ghost-turret placement UX.
 *
 * Economy / pacing (all tunable in TD_CONFIG):
 *   - Each kill drops a coin worth `coinsPerKill`.
 *   - Coins are ONLY collectable in FPS view by walking over them.
 *   - A turret costs coins (escalating per turret) AND you may only field
 *     `allowedTurrets(wave)` at once (≈ one more slot every 2 waves), while the
 *     horde grows every wave — so you must keep going out to farm coins.
 */

const TD_CONFIG = {
    turret: {
        range: 17,            // world units the turret can hit within
        fireRate: 0.5,        // seconds between shots
        damage: 11,           // per shot
        headTurnSpeed: 7,     // radians/sec the head swivels toward a target
        projectileSpeed: 60,  // tracer travel (visual only; damage is instant)
    },
    // Cost of the Nth turret = base + perTurret * (turrets already placed).
    cost: { base: 45, perTurret: 25 },
    coinsPerKill: 7,          // coin value dropped per Skibidi
    pickupRadius: 2.4,        // how close (FPS) the player must be to vacuum a coin
    coinLifetime: 90,         // seconds before an uncollected coin fades away
    // How many turrets may be fielded at the given wave number.
    allowedTurrets(wave) { return 1 + Math.floor(Math.max(0, wave) / 2); },
    // Build-view camera rig (limited pan + zoom). All limits are expressed as
    // multiples of the arena half-size, so they scale with the level. The
    // camera looks at a movable ground "focus" point from a fixed iso angle —
    // panning slides that focus across the field (so you can reach anywhere to
    // place buildings), the wheel zooms the distance.
    camera: {
        isoDir: { x: 0, y: 1.5, z: 1.15 },  // default view direction (un-normalized)
        defaultZoomF: 1.89,                  // start distance ≈ old fixed framing
        zoomMinF: 1.10,                      // closest (most zoomed-in)
        zoomMaxF: 2.60,                      // farthest (most zoomed-out)
        panSpeedF: 0.60,                     // pan units/sec ÷ half, at base zoom
        panMargin: 2,                        // focus stays this far inside the edge
        orbitSpeed: 0.005,                   // radians per pixel of right-drag
        pitchMin: 0.30,                      // ~17° above horizon (limited orbit)
        pitchMax: 1.45,                      // ~83°, near top-down
        fov: 50,
    },
};

/* ───────────────────────────── Turret ───────────────────────────── */

class Turret {
    constructor(scene, position) {
        this.scene = scene;                 // SceneManager
        this.position = position.clone();
        this.position.y = 0;
        this.range = TD_CONFIG.turret.range;
        this.fireRate = TD_CONFIG.turret.fireRate;
        this.damage = TD_CONFIG.turret.damage;
        this.cooldown = 0;
        this.headYaw = 0;
        this.target = null;
        this.muzzleTimer = 0;

        this._buildMesh();
    }

    _buildMesh() {
        const group = new THREE.Group();

        // Sandbag-style ring base (olive, to echo the reference emplacement).
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x6b6a3a, roughness: 1.0, metalness: 0.0, flatShading: true });
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.5, 10), ringMat);
        ring.position.y = 0.25; ring.castShadow = true; ring.receiveShadow = true;
        group.add(ring);

        // Dark steel pedestal.
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.5, flatShading: true });
        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 8), baseMat);
        pedestal.position.y = 0.55; pedestal.castShadow = true;
        group.add(pedestal);

        // Rotating head + twin barrels.
        const head = new THREE.Group();
        head.position.y = 0.85;
        const headMat = new THREE.MeshStandardMaterial({ color: 0x3a4034, roughness: 0.6, metalness: 0.6, flatShading: true });
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.9), headMat);
        housing.castShadow = true;
        head.add(housing);

        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.8 });
        for (const dx of [-0.18, 0.18]) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), barrelMat);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(dx, 0.05, -0.75);
            head.add(barrel);
        }

        // Warm muzzle glow (hidden until firing).
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0 });
        const flash = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), flashMat);
        flash.position.set(0, 0.05, -1.35);
        head.add(flash);
        this.muzzleFlash = flash;

        // Gold crown chip so it reads as the king's own guard turret.
        const crownMat = new THREE.MeshStandardMaterial({ color: 0xffc23a, emissive: 0x7a4d00, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.9 });
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 6), crownMat);
        crown.position.set(0, 0.42, 0.1);
        head.add(crown);

        this.head = head;
        group.add(head);

        // Plant the turret on the terrain surface.
        this.groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z) : 0;
        group.position.set(this.position.x, this.groundY, this.position.z);
        this.mesh = group;
        this.scene.addToScene(group);
    }

    /** Pick the in-range enemy closest to the central base (most urgent threat). */
    _acquireTarget(enemies) {
        if (this.target && this.target.isAlive) {
            const dx = this.target.position.x - this.position.x;
            const dz = this.target.position.z - this.position.z;
            if (dx * dx + dz * dz <= this.range * this.range) return; // keep current
        }
        this.target = null;
        let bestScore = Infinity;
        const r2 = this.range * this.range;
        for (const e of enemies) {
            if (!e.isAlive) continue;
            const dx = e.position.x - this.position.x;
            const dz = e.position.z - this.position.z;
            if (dx * dx + dz * dz > r2) continue;
            // Prefer enemies nearest the base center (they threaten the core first).
            const score = e.position.x * e.position.x + e.position.z * e.position.z;
            if (score < bestScore) { bestScore = score; this.target = e; }
        }
    }

    update(dt, enemies, turretSystem) {
        if (this.cooldown > 0) this.cooldown -= dt;
        if (this.muzzleTimer > 0) {
            this.muzzleTimer -= dt;
            this.muzzleFlash.material.opacity = Math.max(0, this.muzzleTimer / 0.05);
        }

        this._acquireTarget(enemies);
        if (!this.target) return;

        // Aim the head toward the target (yaw only).
        const dx = this.target.position.x - this.position.x;
        const dz = this.target.position.z - this.position.z;
        const desired = Math.atan2(dx, dz);
        let delta = desired - this.headYaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const maxStep = TD_CONFIG.turret.headTurnSpeed * dt;
        this.headYaw += Math.max(-maxStep, Math.min(maxStep, delta));
        this.head.rotation.y = this.headYaw;

        // Fire when cooled down and roughly on target.
        if (this.cooldown <= 0 && Math.abs(delta) < 0.25) {
            this._fire(turretSystem);
            this.cooldown = this.fireRate;
        }
    }

    _fire(turretSystem) {
        const t = this.target;
        if (!t || !t.isAlive) return;

        // Muzzle position (head height) → enemy center mass.
        const muzzle = new THREE.Vector3(this.position.x, (this.groundY || 0) + 0.9, this.position.z);
        const hit = t.position.clone();
        hit.y = (this.scene.getGroundHeight ? this.scene.getGroundHeight(t.position.x, t.position.z) : 0) + 1.2;
        turretSystem.spawnTracer(muzzle, hit);

        this.muzzleTimer = 0.05;
        this.muzzleFlash.material.opacity = 1;

        // Instant damage; lets the central kill-accounting drop coins + score.
        t.lastWeaponIndex = 0;
        t.takeDamage(this.damage);
        if (typeof ZBEffects !== 'undefined' && ZBEffects.spawnHitParticles) {
            ZBEffects.spawnHitParticles(hit, 0xffcf6b, 3);
        }
    }

    dispose() {
        if (this.mesh) this.scene.removeFromScene(this.mesh);
        this.mesh = null;
    }
}

/* ─────────────────────────── TurretSystem ─────────────────────────── */

class TurretSystem {
    constructor(scene) {
        this.scene = scene;
        this.turrets = [];
        this.tracers = [];
    }

    placeTurret(position) {
        const turret = new Turret(this.scene, position);
        this.turrets.push(turret);
        return turret;
    }

    /** Validity check for a candidate placement (returns true if buildable). */
    canPlaceAt(pos, world) {
        // Inside the arena (with a margin from the edge).
        const half = (world.arenaHalfSize ?? 39);
        if (Math.abs(pos.x) > half - 1 || Math.abs(pos.z) > half - 1) return false;
        // Not on top of the base or enemy spire.
        if (Array.isArray(world.towers)) {
            for (const t of world.towers) {
                const dx = pos.x - t.x, dz = pos.z - t.z;
                const clear = (t.radius ?? 1) + 2.0;
                if (dx * dx + dz * dz < clear * clear) return false;
            }
        }
        // Not overlapping another turret.
        for (const tr of this.turrets) {
            const dx = pos.x - tr.position.x, dz = pos.z - tr.position.z;
            if (dx * dx + dz * dz < 3.0 * 3.0) return false;
        }
        return true;
    }

    spawnTracer(from, to) {
        const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
        const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
        const line = new THREE.Line(geo, mat);
        this.scene.addToScene(line);
        this.tracers.push({ line, age: 0, life: 0.09 });
    }

    update(dt, enemies) {
        for (const turret of this.turrets) turret.update(dt, enemies, this);

        for (let i = this.tracers.length - 1; i >= 0; i--) {
            const tr = this.tracers[i];
            tr.age += dt;
            const k = 1 - tr.age / tr.life;
            if (k <= 0) {
                this.scene.removeFromScene(tr.line);
                tr.line.geometry.dispose();
                tr.line.material.dispose();
                this.tracers.splice(i, 1);
            } else {
                tr.line.material.opacity = 0.9 * k;
            }
        }
    }

    reset() {
        for (const t of this.turrets) t.dispose();
        this.turrets = [];
        for (const tr of this.tracers) {
            this.scene.removeFromScene(tr.line);
            tr.line.geometry.dispose();
            tr.line.material.dispose();
        }
        this.tracers = [];
    }
}

/* ──────────────────────────── CoinSystem ──────────────────────────── */

class CoinSystem {
    constructor(scene) {
        this.scene = scene;
        this.coins = [];
        // Shared coin geometry/material template (cloned material per coin so
        // the fade-out doesn't affect every coin at once).
        this._geo = new THREE.CylinderGeometry(0.32, 0.32, 0.1, 12);
    }

    spawn(position, value = TD_CONFIG.coinsPerKill) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffc62e, emissive: 0x6e4400, emissiveIntensity: 0.6,
            roughness: 0.3, metalness: 0.9,
        });
        const mesh = new THREE.Mesh(this._geo, mat);
        mesh.rotation.x = Math.PI / 2; // coin stands like a token
        mesh.castShadow = true;
        // Rest the coin on the terrain surface beneath the death spot.
        const gy = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(position.x, position.z) : 0;
        const baseY = gy + 0.35;
        mesh.position.set(position.x, baseY, position.z);
        this.scene.addToScene(mesh);
        this.coins.push({ mesh, value, age: 0, spin: Math.random() * Math.PI * 2, baseY });
    }

    /**
     * @param {boolean} canCollect true only in FPS view (walking the field).
     * @param {{coins:number}} economy mutated when a coin is vacuumed.
     * @returns {number} coins collected this frame (for pickup feedback).
     */
    update(dt, playerPos, canCollect, economy) {
        let collected = 0;
        const pr2 = TD_CONFIG.pickupRadius * TD_CONFIG.pickupRadius;
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            c.age += dt;
            c.spin += dt * 3;
            c.mesh.rotation.z = c.spin;
            c.mesh.position.y = c.baseY + Math.sin(c.age * 4) * 0.12;

            if (canCollect && playerPos) {
                const dx = c.mesh.position.x - playerPos.x;
                const dz = c.mesh.position.z - playerPos.z;
                if (dx * dx + dz * dz <= pr2) {
                    economy.coins += c.value;
                    collected += c.value;
                    this._remove(i);
                    continue;
                }
            }

            // Fade + sink in the last 3s of life, then despawn.
            const remaining = TD_CONFIG.coinLifetime - c.age;
            if (remaining <= 0) { this._remove(i); continue; }
            if (remaining < 3) {
                c.mesh.material.transparent = true;
                c.mesh.material.opacity = remaining / 3;
            }
        }
        return collected;
    }

    _remove(i) {
        const c = this.coins[i];
        this.scene.removeFromScene(c.mesh);
        c.mesh.material.dispose();
        this.coins.splice(i, 1);
    }

    reset() {
        for (const c of this.coins) {
            this.scene.removeFromScene(c.mesh);
            c.mesh.material.dispose();
        }
        this.coins = [];
    }
}

/* ─────────────────────────── BuildController ─────────────────────────── */
/**
 * Owns the top-down "overwatch" camera and the ghost-turret placement flow.
 * Activated while the game is in iso view. It does not touch the FPS controller
 * beyond reading the shared camera; game.js handles enabling/disabling input.
 */
class BuildController {
    constructor(sceneManager, world, turretSystem, economy, defenseBase = null) {
        this.sceneManager = sceneManager;
        this.world = world;
        this.turretSystem = turretSystem;
        this.economy = economy;
        this.defenseBase = defenseBase;
        this.camera = sceneManager.getCamera();

        this.active = false;
        this.currentWave = 0;
        this._mouseNDC = new THREE.Vector2(0, 0);
        this._ray = new THREE.Raycaster();
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this._hitPoint = new THREE.Vector3();
        this._valid = false;

        // Saved FPS camera state, restored on exit.
        this._savedFov = this.camera.fov;

        // ── Build-view camera rig ──────────────────────────────────────────
        // Camera = a movable ground "focus" point, orbited around by yaw/pitch
        // and pushed back by `_zoom`. Pan slides the focus (clamped to the
        // arena), the wheel zooms, and holding the right mouse button orbits.
        // Limits are resolved in enter() once the arena size is known. See
        // TD_CONFIG.camera.
        const c = TD_CONFIG.camera;
        const isoDir = new THREE.Vector3(c.isoDir.x, c.isoDir.y, c.isoDir.z).normalize();
        this._defaultYaw = Math.atan2(isoDir.x, isoDir.z);  // 0 = looking down -Z
        this._defaultPitch = Math.asin(isoDir.y);           // elevation above ground
        this._yaw = this._defaultYaw;
        this._pitch = this._defaultPitch;
        this._focus = new THREE.Vector3();
        this._zoom = 0;
        this._panKeys = { f: false, b: false, l: false, r: false };
        this._camPos = new THREE.Vector3();
        this._orbiting = false;
        this._lastX = 0;
        this._lastY = 0;

        this._buildGhost();

        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        // Capture-phase down so we place / start-orbit before other handlers.
        window.addEventListener('mousedown', (e) => this._onMouseDown(e), true);
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        // Suppress the browser context menu while right-drag-orbiting.
        window.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
        // Camera rig input (only acts while active).
        window.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        window.addEventListener('keydown', (e) => this._onPanKey(e, true));
        window.addEventListener('keyup', (e) => this._onPanKey(e, false));
    }

    _buildGhost() {
        const group = new THREE.Group();

        // Translucent body footprint.
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.5 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1.0, 8), bodyMat);
        body.position.y = 0.5;
        group.add(body);
        this._ghostBody = body;

        // Range ring on the ground.
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.RingGeometry(TD_CONFIG.turret.range - 0.3, TD_CONFIG.turret.range, 48), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        group.add(ring);
        this._ghostRing = ring;

        group.visible = false;
        this.ghost = group;
        this.sceneManager.addToScene(group);
    }

    setWave(wave) { this.currentWave = wave; }

    /** Cost of the next turret given how many are already fielded. */
    nextCost() {
        return TD_CONFIG.cost.base + TD_CONFIG.cost.perTurret * this.turretSystem.turrets.length;
    }

    allowed() { return TD_CONFIG.allowedTurrets(this.currentWave); }

    /** Reasons placement may be blocked, for HUD feedback. */
    status() {
        return {
            coins: this.economy.coins,
            cost: this.nextCost(),
            used: this.turretSystem.turrets.length,
            allowed: this.allowed(),
        };
    }

    enter() {
        this.active = true;
        // Frame the whole arena from a high angle, centered on the player tower.
        const half = this.world.arenaHalfSize ?? 39;
        const c = TD_CONFIG.camera;
        const lookAt = this.defenseBase?.getLookAtTarget?.()
            ?? new THREE.Vector3(0, (this.world.towers?.[0]?.height ?? 9) * 0.45, 0);

        // Resolve the rig limits for this arena size.
        this._panLimit = Math.max(0, half - c.panMargin);
        this._zoomMin = half * c.zoomMinF;
        this._zoomMax = half * c.zoomMaxF;
        this._baseZoom = half * c.defaultZoomF;
        this._panSpeed = half * c.panSpeedF;

        this._focus.copy(lookAt);
        this._zoom = this._baseZoom;
        this._yaw = this._defaultYaw;
        this._pitch = this._defaultPitch;
        this._orbiting = false;
        this._clearPanKeys();

        this._savedFov = this.camera.fov;
        this.camera.fov = c.fov;
        this.camera.up.set(0, 1, 0);
        this._applyCamera();
        this.ghost.visible = true;
    }

    exit() {
        this.active = false;
        this.ghost.visible = false;
        this._clearPanKeys();
        this.camera.fov = this._savedFov;
        this.camera.updateProjectionMatrix();
    }

    /* ── Camera rig ──────────────────────────────────────────────────────── */

    _clearPanKeys() {
        this._panKeys.f = this._panKeys.b = this._panKeys.l = this._panKeys.r = false;
    }

    /** Position the camera = focus orbited by yaw/pitch and pushed back by zoom. */
    _applyCamera() {
        const cp = Math.cos(this._pitch), sp = Math.sin(this._pitch);
        // Offset direction from focus to camera (yaw around Y, pitch up).
        this._camPos.set(Math.sin(this._yaw) * cp, sp, Math.cos(this._yaw) * cp)
            .multiplyScalar(this._zoom).add(this._focus);
        this.camera.position.copy(this._camPos);
        this.camera.lookAt(this._focus);
        this.camera.updateProjectionMatrix();
    }

    /** Slide the focus point from held pan keys; clamp it inside the arena. */
    _updateCameraRig(dt) {
        const k = this._panKeys;
        const moveF = (k.f ? 1 : 0) - (k.b ? 1 : 0); // forward = away from camera
        const moveR = (k.r ? 1 : 0) - (k.l ? 1 : 0); // strafe right on screen
        if (moveF || moveR) {
            // Pan along the *current* view yaw so W is always "into the screen",
            // even after orbiting. Ground-projected forward/right basis:
            const fwdX = -Math.sin(this._yaw), fwdZ = -Math.cos(this._yaw);
            const rightX = Math.cos(this._yaw), rightZ = -Math.sin(this._yaw);
            let dx = fwdX * moveF + rightX * moveR;
            let dz = fwdZ * moveF + rightZ * moveR;
            const len = Math.hypot(dx, dz) || 1;        // normalize diagonals
            // Pan faster when zoomed out so traversal feels consistent.
            const step = this._panSpeed * (this._zoom / this._baseZoom) * dt;
            const lim = this._panLimit;
            this._focus.x = THREE.MathUtils.clamp(this._focus.x + (dx / len) * step, -lim, lim);
            this._focus.z = THREE.MathUtils.clamp(this._focus.z + (dz / len) * step, -lim, lim);
        }
        this._applyCamera();
    }

    _onWheel(e) {
        if (!this.active) return;
        e.preventDefault();
        // Exponential so each notch is a constant *ratio* of zoom.
        this._zoom = THREE.MathUtils.clamp(
            this._zoom * Math.exp(e.deltaY * 0.001), this._zoomMin, this._zoomMax);
    }

    _onPanKey(e, down) {
        if (!this.active) return;
        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this._panKeys.f = down; break;
            case 'KeyS': case 'ArrowDown':  this._panKeys.b = down; break;
            case 'KeyA': case 'ArrowLeft':  this._panKeys.l = down; break;
            case 'KeyD': case 'ArrowRight': this._panKeys.r = down; break;
            default: return;
        }
        e.preventDefault();
    }

    _onMouseMove(e) {
        if (!this.active) return;
        // Right-drag orbits: horizontal → yaw, vertical → pitch (clamped).
        if (this._orbiting) {
            const c = TD_CONFIG.camera;
            this._yaw -= (e.clientX - this._lastX) * c.orbitSpeed;
            this._pitch = THREE.MathUtils.clamp(
                this._pitch - (e.clientY - this._lastY) * c.orbitSpeed,
                c.pitchMin, c.pitchMax);
            this._lastX = e.clientX;
            this._lastY = e.clientY;
        }
        this._mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
        this._mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    }

    _onMouseDown(e) {
        if (!this.active) return;
        // Right button → begin orbiting (don't place).
        if (e.button === 2) {
            e.preventDefault();
            this._orbiting = true;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            return;
        }
        if (e.button !== 0) return;
        // Consume the left click so it doesn't reach the FPS pointer-lock handler.
        e.preventDefault();
        e.stopPropagation();
        this._tryPlace();
    }

    _onMouseUp(e) {
        if (e.button === 2) this._orbiting = false;
    }

    _tryPlace() {
        if (!this._valid) return;
        const s = this.status();
        if (s.used >= s.allowed) { this._flashGhost(0xff5a3a); return; }
        if (s.coins < s.cost) { this._flashGhost(0xff5a3a); return; }
        this.economy.coins -= s.cost;
        this.turretSystem.placeTurret(this._hitPoint.clone());
    }

    _flashGhost(color) {
        // Brief red flash to signal "can't place".
        this._ghostBody.material.color.setHex(color);
        this._ghostRing.material.color.setHex(color);
        clearTimeout(this._flashT);
        this._flashT = setTimeout(() => { /* color refreshed each update */ }, 120);
    }

    update(dt = 0) {
        if (!this.active) return;

        // 1. Move the camera (pan keys + zoom), then re-aim the ghost below.
        this._updateCameraRig(dt);

        // 2. Ghost placement preview under the cursor.
        this._ray.setFromCamera(this._mouseNDC, this.camera);
        const hit = this._ray.ray.intersectPlane(this._groundPlane, this._hitPoint);
        if (!hit) { this.ghost.visible = false; return; }
        this.ghost.visible = true;
        const gy = this.sceneManager.getGroundHeight
            ? this.sceneManager.getGroundHeight(this._hitPoint.x, this._hitPoint.z) : 0;
        this.ghost.position.set(this._hitPoint.x, gy, this._hitPoint.z);

        const s = this.status();
        const placeable = this.turretSystem.canPlaceAt(this._hitPoint, this.world);
        const affordable = s.coins >= s.cost && s.used < s.allowed;
        this._valid = placeable && affordable;

        const color = this._valid ? 0x39ff88 : 0xff5a3a;
        this._ghostBody.material.color.setHex(color);
        this._ghostRing.material.color.setHex(color);
    }
}

// Expose globals (loaded via <script>, not ES modules).
window.TD_CONFIG = TD_CONFIG;
window.Turret = Turret;
window.TurretSystem = TurretSystem;
window.CoinSystem = CoinSystem;
window.BuildController = BuildController;
