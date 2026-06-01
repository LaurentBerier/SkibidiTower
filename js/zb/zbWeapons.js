/**
 * zbWeapons.js - Franken-Gun arsenal ported from ZombieBlaster (weapons.js)
 *
 * Four projectile weapons with 1-4/scroll switching, reload, score-based
 * evolution tiers, muzzle flash, ADS spread, and a pooled projectile system.
 * The unused hitscan/beam/chain-lightning paths from the original (no shipped
 * weapon used them) are dropped.
 *
 * Adapted to Skibidi Tower: dependencies come from globals (ZB_COLORS,
 * zbCreateToonMaterial, zbAddOutline, ZBAssets, ZBEffects) and the FPS
 * controller, and enemy/wall collision uses Skibidi's enemy shape + the square
 * arena / tower-cylinder world instead of ZombieBlaster's AABB wall list.
 *
 * Exposed as the global `WeaponSystem` class. Construct with
 * (sceneManager, controller, world); call init(), update(dt, enemies, onHit)
 * each frame, switchWeapon(i), updateEvolution(score), reset(), getStats().
 */
class WeaponSystem {
    constructor(sceneManager, controller, world) {
        this.sceneManager = sceneManager;
        this.scene = sceneManager.getScene();
        this.controller = controller;
        this.world = world;

        this.INFINITE_AMMO = true;
        this.MAX_PROJECTILES = 80;

        const C = window.ZB_COLORS;
        this.WEAPON_DEFS = [
            {
                name: 'FRANKEN-GUN', description: 'Cobbled-together plasma rifle',
                fireRate: 0.15, damage: 15, ammo: 30, maxAmmo: 120, reloadTime: 1.5,
                type: 'projectile', projectileType: 'plasma', projectileSpeed: 45,
                projectileRadius: 0.18, spread: 0.02, color: C.magenta, projectileColor: C.magenta,
                fx: { element: 'shock', knockback: 3.0, status: { type: 'shock', duration: 0.4, dps: 0 }, hitParticles: 8, shake: { amp: 0.08, duration: 0.08 }, killShake: { amp: 0.12, duration: 0.12 }, splash: null, trail: 'plasma' },
                evolutionLevels: [
                    { scoreThreshold: 0, name: 'FRANKEN-GUN Mk.I', damage: 15, fireRate: 0.15, color: C.magenta },
                    { scoreThreshold: 2000, name: 'FRANKEN-GUN Mk.II', damage: 22, fireRate: 0.12, color: C.hotPink },
                    { scoreThreshold: 5000, name: 'FRANKEN-GUN Mk.III', damage: 30, fireRate: 0.10, color: C.yellow },
                ],
            },
            {
                name: 'BOWLING LAUNCHER', description: 'Heavy rocket launcher',
                fireRate: 0.8, damage: 60, ammo: 8, maxAmmo: 32, reloadTime: 2.0,
                type: 'projectile', projectileType: 'rocket', spread: 0.0, projectileSpeed: 22,
                projectileRadius: 0.3, color: C.orange, projectileColor: C.orange, aoe: true, aoeRadius: 3.5,
                fx: { element: 'fire', knockback: 6.0, status: { type: 'burn', duration: 2.5, dps: 8 }, hitParticles: 4, shake: { amp: 0.35, duration: 0.25 }, killShake: { amp: 0.5, duration: 0.35 }, splash: 'explosion', trail: 'smoke', explosionRadius: 3.5 },
                evolutionLevels: [
                    { scoreThreshold: 0, name: 'BOWLING LAUNCHER Mk.I', damage: 60, fireRate: 0.8, color: C.orange },
                    { scoreThreshold: 2000, name: 'BOWLING LAUNCHER Mk.II', damage: 85, fireRate: 0.65, color: C.yellow },
                    { scoreThreshold: 5000, name: 'BOWLING LAUNCHER Mk.III', damage: 120, fireRate: 0.5, color: C.red },
                ],
            },
            {
                name: 'SODA LASER', description: 'Corrosive acid sprayer',
                fireRate: 0.05, damage: 5, ammo: 100, maxAmmo: 400, reloadTime: 2.5,
                type: 'projectile', projectileType: 'liquid', projectileSpeed: 35,
                projectileRadius: 0.12, spread: 0.025, color: C.cyan, projectileColor: C.cyan,
                fx: { element: 'acid', knockback: 0.8, status: { type: 'corrode', duration: 1.5, dps: 3 }, hitParticles: 3, shake: { amp: 0.02, duration: 0.04 }, killShake: { amp: 0.05, duration: 0.08 }, splash: 'liquid', acidPoolChance: 0.3, acidPoolRadius: 1.2, acidPoolDuration: 2.0, acidPoolDps: 5 },
                evolutionLevels: [
                    { scoreThreshold: 0, name: 'SODA LASER Mk.I', damage: 5, fireRate: 0.05, color: C.cyan },
                    { scoreThreshold: 2000, name: 'SODA LASER Mk.II', damage: 8, fireRate: 0.04, color: C.lime },
                    { scoreThreshold: 5000, name: 'SODA LASER Mk.III', damage: 12, fireRate: 0.03, color: C.green },
                ],
            },
            {
                name: 'CRYO BLASTER', description: 'Continuous freezing-goo stream',
                fireRate: 0.06, damage: 7, ammo: 80, maxAmmo: 320, reloadTime: 2.2,
                type: 'projectile', projectileType: 'blob', projectileSpeed: 32,
                projectileRadius: 0.18, spread: 0.02, color: C.cyan, projectileColor: C.cyan,
                fx: { element: 'freeze', knockback: 0.6, status: { type: 'freeze', duration: 0.5, dps: 0 }, hitParticles: 2, shake: { amp: 0.015, duration: 0.03 }, killShake: { amp: 0.08, duration: 0.1 }, splash: 'liquid', splashCount: 6, trail: 'droplet' },
                evolutionLevels: [
                    { scoreThreshold: 0, name: 'CRYO BLASTER Mk.I', damage: 7, fireRate: 0.06, color: C.cyan },
                    { scoreThreshold: 2000, name: 'CRYO BLASTER Mk.II', damage: 10, fireRate: 0.05, color: 0x66e6ff },
                    { scoreThreshold: 5000, name: 'CRYO BLASTER Mk.III', damage: 14, fireRate: 0.04, color: C.white },
                ],
            },
        ];

        this.weaponState = {
            currentIndex: 0,
            fireTimer: 0,
            isReloading: false,
            reloadTimer: 0,
            currentAmmo: [],
            reserveAmmo: [],
            meshes: [],
            activeEvolutionLevel: [0, 0, 0, 0],
        };

        this.projectiles = [];
        this.muzzleFlash = null;
        this.muzzleFlashTimer = 0;

        this.PROJECTILE_TYPE_CONFIG = {
            plasma: { lifetime: 1.2, gravity: 0, trail: 'plasma', trailInterval: 0.035 },
            rocket: { lifetime: 30.0, gravity: 0, trail: 'smoke', trailInterval: 0.035 },
            liquid: { lifetime: 0.8, gravity: 4.0, trail: null, trailInterval: 0.035 },
            blob: { lifetime: 0.9, gravity: 5.0, trail: 'droplet', trailInterval: 0.18 },
            default: { lifetime: 3.0, gravity: 0, trail: null, trailInterval: 0.035 },
        };
    }

    init() {
        const C = window.ZB_COLORS;
        this.WEAPON_DEFS.forEach((def, i) => {
            this.weaponState.currentAmmo[i] = def.ammo;
            this.weaponState.reserveAmmo[i] = def.maxAmmo;
        });

        this.createWeaponMeshes();

        // Muzzle flash
        const flashGeo = new THREE.SphereGeometry(0.08, 6, 6);
        const flashMat = zbCreateToonMaterial(C.yellow, C.yellow, 2.0);
        this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
        this.muzzleFlash.visible = false;
        if (this.controller.weaponGroup) {
            this.muzzleFlash.position.set(0, 0.02, -0.55);
            this.controller.weaponGroup.add(this.muzzleFlash);
        }

        // Projectile pool
        for (let i = 0; i < this.MAX_PROJECTILES; i++) {
            const projRoot = new THREE.Group();
            const projGeo = new THREE.SphereGeometry(0.15, 8, 8);
            const projMat = zbCreateToonMaterial(C.orange, C.orange, 1.5);
            const projMesh = new THREE.Mesh(projGeo, projMat);
            projRoot.add(projMesh);
            const glowGeo = new THREE.SphereGeometry(0.25, 6, 6);
            const glowMat = new THREE.MeshBasicMaterial({ color: C.orange, transparent: true, opacity: 0.3 });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            projRoot.add(glow);
            projRoot.visible = false;
            projRoot.userData = {
                active: false, velocity: new THREE.Vector3(), damage: 0, lifetime: 0,
                aoe: false, aoeRadius: 0, weaponIndex: 0, projectileType: 'rocket',
                gravity: 0, trail: null, trailTimer: 0, color: C.orange,
            };
            this.scene.add(projRoot);
            this.projectiles.push(projRoot);
        }
    }

    applyNeonAccentGlow(root) {
        root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (!mat.color || !mat.emissive) return;
                const hsl = { h: 0, s: 0, l: 0 };
                mat.color.getHSL(hsl);
                const isNeonAccent =
                    ((hsl.h > 0.20 && hsl.h < 0.48) || (hsl.h > 0.48 && hsl.h < 0.62) || (hsl.h > 0.12 && hsl.h <= 0.20)) &&
                    hsl.s > 0.12;
                if (isNeonAccent) {
                    mat.emissive.copy(mat.color).multiplyScalar(0.7);
                    mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 0.95);
                }
            });
        });
    }

    attachFirstPersonGlbMesh(mesh, glbRoot, opts = {}) {
        const scale = opts.scaleScalar ?? 0.45;
        const px = opts.positionX ?? 0.02;
        const py = opts.positionY ?? -0.1;
        const pz = opts.positionZ ?? -0.35;
        const ryOffset = opts.rotationYOffset ?? 0;
        glbRoot.scale.setScalar(scale);
        glbRoot.rotation.set(-0.08, Math.PI * 1.5 + ryOffset, 0);
        glbRoot.position.set(px, py, pz);
        this.applyNeonAccentGlow(glbRoot);
        mesh.add(glbRoot);
    }

    createWeaponMeshes() {
        const weaponGroup = this.controller.weaponGroup;
        if (!weaponGroup) return;

        const FP_WEAPON_2_3 = { scaleScalar: 0.9, positionY: -0.03 };
        const FP_WEAPON_3 = { ...FP_WEAPON_2_3, rotationYOffset: Math.PI / 2, scaleScalar: FP_WEAPON_2_3.scaleScalar * 1.5 };

        this.WEAPON_DEFS.forEach((def, i) => {
            const mesh = new THREE.Group();
            mesh.name = `weapon_${i}`;

            let glb = null;
            if (i === 0) glb = ZBAssets.cloneAsset('weapon_biohazard');
            else if (i === 1) glb = ZBAssets.cloneAsset('weapon_plasma_coil');
            else if (i === 2) glb = ZBAssets.cloneAsset('weapon_ember_blaster');
            else if (i === 3) glb = ZBAssets.cloneAsset('weapon_neon_plasma_blaster');

            if (glb) {
                const opts = i === 0 ? {} : (i === 2 ? FP_WEAPON_3 : FP_WEAPON_2_3);
                this.attachFirstPersonGlbMesh(mesh, glb, opts);
            } else {
                this.addWeaponPlaceholder(mesh, def, i);
            }

            mesh.visible = (i === 0);
            weaponGroup.add(mesh);
            this.weaponState.meshes.push(mesh);
        });
    }

    addWeaponPlaceholder(mesh, def, i) {
        const C = window.ZB_COLORS;
        const bodyGeo = new THREE.BoxGeometry(0.15, 0.12, 0.5);
        const body = new THREE.Mesh(bodyGeo, zbCreateToonMaterial(0x333340));
        mesh.add(body);
        zbAddOutline(body, bodyGeo, 1.08);

        const barrelGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.35, 6);
        const barrel = new THREE.Mesh(barrelGeo, zbCreateToonMaterial(def.color, def.color, 0.3));
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.35);
        mesh.add(barrel);

        if (i === 1) {
            const wideGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.25, 8);
            const wide = new THREE.Mesh(wideGeo, zbCreateToonMaterial(def.color, def.color, 0.2));
            wide.rotation.x = Math.PI / 2;
            wide.position.set(0, 0, -0.45);
            mesh.add(wide);
        } else if (i === 2) {
            const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8), zbCreateToonMaterial(C.red));
            can.position.set(0, 0.1, -0.15);
            mesh.add(can);
            const lens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), zbCreateToonMaterial(C.cyan, C.cyan, 1.0));
            lens.position.set(0, 0.02, -0.52);
            mesh.add(lens);
        } else if (i === 3) {
            const teslaGeo = new THREE.ConeGeometry(0.04, 0.12, 6);
            const teslaMat = zbCreateToonMaterial(C.lime, C.lime, 0.5);
            [-0.06, 0.06].forEach(x => {
                const t = new THREE.Mesh(teslaGeo, teslaMat);
                t.position.set(x, 0.1, -0.25);
                mesh.add(t);
            });
        } else {
            const coilGeo = new THREE.TorusGeometry(0.05, 0.015, 4, 8);
            const coilMat = zbCreateToonMaterial(C.lime, C.lime, 0.8);
            for (let c = 0; c < 3; c++) {
                const coil = new THREE.Mesh(coilGeo, coilMat);
                coil.position.set(0, 0.07, -0.1 - c * 0.1);
                coil.rotation.y = Math.PI / 2;
                mesh.add(coil);
            }
            const tank = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), zbCreateToonMaterial(C.cyan));
            tank.position.set(0.1, 0, -0.1);
            mesh.add(tank);
        }

        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.08), zbCreateToonMaterial(0x444455));
        handle.position.set(0, -0.1, -0.05);
        handle.rotation.x = 0.3;
        mesh.add(handle);
    }

    getCurrentWeapon() {
        return this.WEAPON_DEFS[this.weaponState.currentIndex];
    }

    getCurrentEvolution() {
        const weapon = this.getCurrentWeapon();
        const level = this.weaponState.activeEvolutionLevel[this.weaponState.currentIndex];
        return weapon.evolutionLevels[level] || weapon.evolutionLevels[0];
    }

    switchWeapon(index) {
        if (index < 0 || index >= this.WEAPON_DEFS.length) return;
        if (index === this.weaponState.currentIndex) return;
        if (this.weaponState.isReloading) return;
        this.weaponState.meshes[this.weaponState.currentIndex].visible = false;
        this.weaponState.currentIndex = index;
        this.weaponState.meshes[index].visible = true;
        this.weaponState.fireTimer = 0;
        const mesh = this.weaponState.meshes[index];
        mesh.position.y = -0.15;
        mesh.rotation.x = 0.2;
    }

    update(dt, enemies, onHitCallback) {
        const weapon = this.getCurrentWeapon();
        const evolution = this.getCurrentEvolution();
        const keys = this.controller.keys;

        const mesh = this.weaponState.meshes[this.weaponState.currentIndex];
        mesh.position.y *= 0.85;
        mesh.rotation.x *= 0.85;

        if (this.weaponState.fireTimer > 0) this.weaponState.fireTimer -= dt;

        if (this.weaponState.isReloading) {
            this.weaponState.reloadTimer -= dt;
            mesh.rotation.z = Math.sin(this.weaponState.reloadTimer * 12) * 0.05;
            if (this.weaponState.reloadTimer <= 0) {
                this.weaponState.isReloading = false;
                mesh.rotation.z = 0;
                const idx = this.weaponState.currentIndex;
                const needed = this.WEAPON_DEFS[idx].ammo - this.weaponState.currentAmmo[idx];
                const available = Math.min(needed, this.weaponState.reserveAmmo[idx]);
                this.weaponState.currentAmmo[idx] += available;
                this.weaponState.reserveAmmo[idx] -= available;
            }
            this.updateProjectiles(dt, enemies, onHitCallback);
            return;
        }

        if (keys.reload && this.weaponState.currentAmmo[this.weaponState.currentIndex] < weapon.ammo) {
            this.startReload();
            this.updateProjectiles(dt, enemies, onHitCallback);
            return;
        }

        if (keys.fire && this.weaponState.fireTimer <= 0 && this.weaponState.currentAmmo[this.weaponState.currentIndex] > 0) {
            this.fireWeapon(weapon, evolution, enemies, onHitCallback);
            this.weaponState.fireTimer = evolution.fireRate;
            if (!this.INFINITE_AMMO) {
                this.weaponState.currentAmmo[this.weaponState.currentIndex]--;
                if (this.weaponState.currentAmmo[this.weaponState.currentIndex] <= 0 && this.weaponState.reserveAmmo[this.weaponState.currentIndex] > 0) {
                    this.startReload();
                }
            }
        }

        if (this.muzzleFlashTimer > 0) {
            this.muzzleFlashTimer -= dt;
            if (this.muzzleFlashTimer <= 0 && this.muzzleFlash) this.muzzleFlash.visible = false;
        }

        this.updateProjectiles(dt, enemies, onHitCallback);
    }

    startReload() {
        this.weaponState.isReloading = true;
        this.weaponState.reloadTimer = this.WEAPON_DEFS[this.weaponState.currentIndex].reloadTime;
    }

    fireWeapon(weapon, evolution, enemies, onHitCallback) {
        const origin = this.controller.getPosition();
        const dir = this.controller.getForward();
        const keys = this.controller.keys;
        const spreadMultiplier = keys.aim ? 0.25 : 1.0;
        const activeSpread = weapon.spread * spreadMultiplier;

        dir.x += (Math.random() - 0.5) * activeSpread;
        dir.y += (Math.random() - 0.5) * activeSpread;
        dir.z += (Math.random() - 0.5) * activeSpread;
        dir.normalize();

        if (this.muzzleFlash) {
            this.muzzleFlash.visible = true;
            this.muzzleFlash.material.color.setHex(evolution.color);
            this.muzzleFlash.material.emissive.setHex(evolution.color);
            this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
            this.muzzleFlashTimer = 0.05;
        }

        const mesh = this.weaponState.meshes[this.weaponState.currentIndex];
        mesh.position.z = 0.05;
        mesh.rotation.x = -0.08;

        this.spawnProjectile(origin, dir, evolution, weapon);
    }

    spawnProjectile(origin, dir, evolution, weapon) {
        const proj = this.projectiles.find(p => !p.userData.active);
        if (!proj) return;
        const typeCfg = this.PROJECTILE_TYPE_CONFIG[weapon.projectileType] || this.PROJECTILE_TYPE_CONFIG.default;

        proj.userData.active = true;
        proj.userData.velocity.copy(dir).multiplyScalar(weapon.projectileSpeed);
        proj.userData.damage = evolution.damage;
        proj.userData.lifetime = typeCfg.lifetime;
        proj.userData.aoe = weapon.aoe || false;
        proj.userData.aoeRadius = weapon.aoeRadius || 0;
        proj.userData.weaponIndex = this.weaponState.currentIndex;
        proj.userData.projectileType = weapon.projectileType || 'default';
        proj.userData.gravity = typeCfg.gravity;
        proj.userData.trail = typeCfg.trail;
        proj.userData.trailInterval = typeCfg.trailInterval ?? 0.035;
        proj.userData.trailTimer = 0;
        proj.userData.color = evolution.color;

        proj.position.copy(origin).add(dir.clone().multiplyScalar(1));
        proj.visible = true;

        proj.children[0].material.color.setHex(evolution.color);
        proj.children[0].material.emissive.setHex(evolution.color);
        proj.children[1].material.color.setHex(evolution.color);

        const radius = weapon.projectileRadius || 0.15;
        const baseScale = radius / 0.15;
        proj.children[0].scale.setScalar(baseScale);
        proj.children[1].scale.setScalar(baseScale);
        proj.children[0].userData.baseScale = baseScale;
        proj.children[1].userData.baseScale = baseScale;
    }

    // World collision test for projectiles: outside the arena, inside a tower
    // cylinder, or below the floor counts as a wall hit.
    hitsWorld(pos) {
        const half = this.world.arenaHalfSize;
        if (Math.abs(pos.x) >= half || Math.abs(pos.z) >= half) return true;
        if (pos.y <= 0) return true;
        if (Array.isArray(this.world.towers)) {
            for (const t of this.world.towers) {
                const dx = pos.x - t.x;
                const dz = pos.z - t.z;
                if (dx * dx + dz * dz < (t.radius ?? 1) * (t.radius ?? 1) && pos.y < (t.height ?? 999)) {
                    return true;
                }
            }
        }
        return false;
    }

    updateProjectiles(dt, enemies, onHitCallback) {
        this.projectiles.forEach(proj => {
            if (!proj.userData.active) return;

            proj.userData.lifetime -= dt;
            if (proj.userData.lifetime <= 0) {
                if (proj.userData.projectileType === 'rocket') this.detonateProjectile(proj, enemies, onHitCallback);
                this.deactivateProjectile(proj);
                return;
            }

            if (proj.userData.gravity) proj.userData.velocity.y -= proj.userData.gravity * dt;
            proj.position.add(proj.userData.velocity.clone().multiplyScalar(dt));

            const pType = proj.userData.projectileType;
            if (pType === 'liquid' || pType === 'blob') {
                const wobble = 0.9 + Math.sin(proj.userData.lifetime * 30) * 0.15;
                proj.children[1].scale.set(wobble, 1 / wobble, wobble);
                if (pType === 'blob') {
                    const core = 1.0 + Math.sin(proj.userData.lifetime * 22) * 0.08;
                    proj.children[0].scale.setScalar((proj.children[0].userData.baseScale || 2.0) * core);
                }
            } else if (pType === 'rocket') {
                proj.rotation.z += dt * 2;
            } else {
                proj.rotation.x += dt * 8;
                proj.rotation.z += dt * 6;
            }

            if (proj.userData.trail) {
                proj.userData.trailTimer += dt;
                if (proj.userData.trailTimer >= proj.userData.trailInterval) {
                    proj.userData.trailTimer = 0;
                    if (proj.userData.trail === 'plasma') ZBEffects.spawnPlasmaTrail(proj.position, proj.userData.color);
                    else if (proj.userData.trail === 'smoke') ZBEffects.spawnSmokeTrail(proj.position);
                    else if (proj.userData.trail === 'droplet') ZBEffects.spawnDropletTrail(proj.position, proj.userData.color);
                }
            }

            // Enemy collision (body center y=1.0)
            const projRadius = 0.3;
            let hit = false;
            for (let e = 0; e < enemies.length; e++) {
                const enemy = enemies[e];
                if (!enemy.isAlive || hit) continue;
                const ex = enemy.position.x, ey = 1.0, ez = enemy.position.z;
                const dx = proj.position.x - ex, dy = proj.position.y - ey, dz = proj.position.z - ez;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < (enemy.hitRadius ?? 0.7) + projRadius + 0.5) {
                    onHitCallback(enemy, proj.position.clone(), proj.userData.damage, proj.userData.weaponIndex);
                    hit = true;
                    if (proj.userData.aoe) {
                        const splashCenter = proj.position.clone();
                        enemies.forEach(other => {
                            if (!other.isAlive || other === enemy) return;
                            const ocx = other.position.x, ocy = 1.0, ocz = other.position.z;
                            const adx = proj.position.x - ocx, ady = proj.position.y - ocy, adz = proj.position.z - ocz;
                            const aoeDist = Math.sqrt(adx * adx + ady * ady + adz * adz);
                            if (aoeDist < proj.userData.aoeRadius) {
                                const falloff = 1 - (aoeDist / proj.userData.aoeRadius);
                                onHitCallback(other, other.position.clone().setY(1), proj.userData.damage * falloff * 0.5, proj.userData.weaponIndex, { fromSplash: true, splashCenter });
                            }
                        });
                    }
                }
            }

            let wallHit = false;
            if (!hit && this.hitsWorld(proj.position)) wallHit = true;

            if (wallHit && proj.userData.projectileType === 'rocket') {
                this.detonateProjectile(proj, enemies, onHitCallback);
            }

            if (hit || wallHit) this.deactivateProjectile(proj);
        });
    }

    deactivateProjectile(proj) {
        proj.userData.active = false;
        proj.visible = false;
    }

    detonateProjectile(proj, enemies, onHitCallback) {
        const weapon = this.WEAPON_DEFS[proj.userData.weaponIndex];
        const fx = weapon?.fx;
        if (fx?.splash !== 'explosion') return;
        const radius = fx.explosionRadius || proj.userData.aoeRadius || weapon.aoeRadius || 3.0;
        const color = proj.userData.color;
        ZBEffects.spawnExplosion(proj.position.clone(), radius, color);
        const splashCenter = proj.position.clone();
        const radiusSq = radius * radius;
        enemies.forEach(enemy => {
            if (!enemy.isAlive) return;
            const ec = enemy.position;
            const dx = ec.x - splashCenter.x;
            const dz = ec.z - splashCenter.z;
            const dy = (1.0) - splashCenter.y;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > radiusSq) return;
            const dist = Math.sqrt(distSq);
            const falloff = 1 - (dist / radius);
            onHitCallback(enemy, enemy.position.clone().setY(1), proj.userData.damage * falloff * 0.5, proj.userData.weaponIndex, { fromSplash: true, splashCenter });
        });
    }

    updateEvolution(score) {
        this.WEAPON_DEFS.forEach((def, i) => {
            for (let lvl = def.evolutionLevels.length - 1; lvl >= 0; lvl--) {
                if (score >= def.evolutionLevels[lvl].scoreThreshold) {
                    this.weaponState.activeEvolutionLevel[i] = lvl;
                    break;
                }
            }
        });
    }

    reset() {
        this.weaponState.currentIndex = 0;
        this.weaponState.fireTimer = 0;
        this.weaponState.isReloading = false;
        this.weaponState.activeEvolutionLevel = [0, 0, 0, 0];
        this.WEAPON_DEFS.forEach((def, i) => {
            this.weaponState.currentAmmo[i] = def.ammo;
            this.weaponState.reserveAmmo[i] = def.maxAmmo;
        });
        this.weaponState.meshes.forEach((m, i) => {
            m.visible = (i === 0);
            m.position.set(0, 0, 0);
            m.rotation.set(0, 0, 0);
        });
        this.projectiles.forEach(p => this.deactivateProjectile(p));
    }

    getStats() {
        const idx = this.weaponState.currentIndex;
        return {
            weaponName: this.getCurrentEvolution().name,
            weaponIndex: idx,
            ammo: this.INFINITE_AMMO ? Infinity : this.weaponState.currentAmmo[idx],
            reserve: this.INFINITE_AMMO ? Infinity : this.weaponState.reserveAmmo[idx],
            isReloading: this.weaponState.isReloading,
        };
    }
}

window.WeaponSystem = WeaponSystem;
