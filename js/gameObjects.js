/**
 * gameObjects.js - Game Entity Classes
 * Defines Base, Enemy, Weapon, and Projectile classes
 */

/**
 * DefenseBase - The central objective to defend
 */
class DefenseBase {
    /**
     * Preload the player watch-tower GLB before any DefenseBase is constructed.
     * onComplete is always called (even on error, so the game can use the fallback).
     */
    static preload(onComplete) {
        if (DefenseBase.modelTemplate) {
            onComplete();
            return;
        }

        const LoaderCtor = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
            ? THREE.GLTFLoader
            : (typeof GLTFLoader !== 'undefined' ? GLTFLoader : null);

        if (!LoaderCtor) {
            console.warn('GLTFLoader not available — defense base will use fallback geometry.');
            onComplete();
            return;
        }

        const loader = new LoaderCtor();
        loader.load(
            'assets/Level/Player_WatchTower.glb',
            (gltf) => {
                DefenseBase.modelTemplate = gltf.scene;
                DefenseBase.modelTemplate.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                console.log('Player watch tower model preloaded successfully!');
                onComplete();
            },
            undefined,
            (error) => {
                console.warn('Could not preload player watch tower, will use fallback geometry:', error);
                onComplete();
            }
        );
    }

    constructor(scene, config = null) {
        this.scene = scene;
        const cfg = config || {};
        this.maxHealth = cfg.maxHealth ?? 100;
        this.health = this.maxHealth;
        this.mesh = null;
        this.position = new THREE.Vector3(cfg.x ?? 0, cfg.y ?? 0, cfg.z ?? 0);
        // Used by enemies (cylindrical collision) and the player (tower-top
        // movement). Authoring these in the editor lets the same code drive
        // a wider or taller tower without per-class tweaks.
        this.collisionRadius = cfg.radius ?? 2.5;
        this.height = cfg.height ?? 6.5;

        this.createMesh();
    }

    createMesh() {
        if (DefenseBase.modelTemplate) {
            this.createModelMesh();
        } else {
            this.createFallbackMesh();
        }
        this._addTowerLights(this.mesh);
        this._addBuildViewAccents(this.mesh);
    }

    /** Deep-clone materials and tune for the dark storm lighting. */
    _prepareModelMaterials(root) {
        const env = this.scene.getScene?.()?.environment ?? null;
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.visible = true;
            child.frustumCulled = false;
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.geometry) {
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
            }
            const srcMats = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = srcMats.map((m) => (m ? m.clone() : m));
            child.material = cloned.length === 1 ? cloned[0] : cloned;
            for (const mat of cloned) {
                if (!mat) continue;
                if (env && mat.isMeshStandardMaterial) {
                    mat.envMap = env;
                    mat.envMapIntensity = 1.2;
                }
                if (mat.emissive) {
                    if (mat.emissive.r + mat.emissive.g + mat.emissive.b < 0.05) {
                        mat.emissive.setHex(0x554433);
                    }
                    mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 0.45);
                }
                if (typeof mat.roughness === 'number') mat.roughness = Math.min(mat.roughness, 0.92);
            }
        });
    }

    /** Warm key + cool fill so the tower reads in iso silhouettes. */
    _addTowerLights(group) {
        const h = this.height;
        const reach = Math.max(this.collisionRadius * 10, h * 2);
        this.coreLight = new THREE.PointLight(0xffd770, 4, reach);
        this.coreLight.position.set(0, h * 0.55, 0);
        group.add(this.coreLight);

        this.fillLight = new THREE.PointLight(0xc8d4f0, 2.2, reach * 0.85);
        this.fillLight.position.set(0, h * 0.9, 0);
        group.add(this.fillLight);
    }

    /** Unlit rings that stay visible in the top-down build view. */
    _addBuildViewAccents(group) {
        const r = this.collisionRadius;
        const h = this.height;
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffc23a,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            fog: false,
        });
        const foot = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r * 1.08, 40), ringMat);
        foot.rotation.x = -Math.PI / 2;
        foot.position.y = 0.12;
        foot.renderOrder = 30;
        group.add(foot);

        const crown = new THREE.Mesh(new THREE.RingGeometry(r * 0.68, r * 0.98, 40), ringMat.clone());
        crown.rotation.x = -Math.PI / 2;
        crown.position.y = h * 0.94;
        crown.renderOrder = 30;
        group.add(crown);
    }

    createModelMesh() {
        this.mesh = new THREE.Group();

        const model = DefenseBase.modelTemplate.clone(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const preMinY = box.min.y;
        const footRadius = Math.max(size.x, size.z) * 0.5 || 1;

        const sx = this.collisionRadius / footRadius;
        const sy = this.height / (size.y || 1);
        const sz = this.collisionRadius / footRadius;
        model.scale.set(sx, sy, sz);
        model.position.y = -preMinY * sy;

        this._prepareModelMaterials(model);
        this.mesh.add(model);

        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z)
            : this.position.y;
        this.mesh.position.set(this.position.x, groundY, this.position.z);

        this.scene.addToScene(this.mesh);
    }

    /** World-space point for iso build camera to frame the tower. */
    getLookAtTarget() {
        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z)
            : this.position.y;
        return new THREE.Vector3(this.position.x, groundY + this.height * 0.45, this.position.z);
    }

    createFallbackMesh() {
        const group = new THREE.Group();

        // Main tower body — grim mossy stone keep.
        const bodyGeometry = new THREE.CylinderGeometry(2, 2.5, 6, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x4c4f59,
            roughness: 0.95,
            metalness: 0.1,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 3;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Gold battlement band.
        const topGeometry = new THREE.CylinderGeometry(2.2, 2.2, 0.5, 8);
        const topMaterial = new THREE.MeshStandardMaterial({
            color: 0xffc23a,
            roughness: 0.3,
            metalness: 0.85,
            emissive: 0x6e4400,
            emissiveIntensity: 0.4,
            flatShading: true
        });
        const top = new THREE.Mesh(topGeometry, topMaterial);
        top.position.y = 6.3;
        top.castShadow = true;
        group.add(top);

        // Core sphere (glowing center)
        const coreGeometry = new THREE.SphereGeometry(0.8, 8, 8);
        const coreMaterial = new THREE.MeshStandardMaterial({
            color: 0xFFD700,
            emissive: 0xFFD700,
            emissiveIntensity: 0.8,
            roughness: 0.2,
            metalness: 0.8
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.y = 4;
        group.add(core);

        // The mesh above is modelled at a reference size (radius 2.5, height
        // 6.5). Scale the whole group so the tower visually matches the
        // configured collision radius / height — lets the level make a
        // smaller (or larger) tower without re-authoring the geometry.
        const REF_RADIUS = 2.5;
        const REF_HEIGHT = 6.5;
        group.scale.set(
            this.collisionRadius / REF_RADIUS,
            this.height / REF_HEIGHT,
            this.collisionRadius / REF_RADIUS
        );

        this.mesh = group;
        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z)
            : this.position.y;
        this.mesh.position.set(this.position.x, groundY, this.position.z);

        this.scene.addToScene(this.mesh);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);

        // Visual feedback — flash all mesh materials red briefly.
        const originalColors = [];
        this.mesh.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
                if (mat.color) {
                    originalColors.push({ mat, color: mat.color.getHex() });
                    mat.color.setHex(0xFF0000);
                }
            }
        });

        setTimeout(() => {
            for (const { mat, color } of originalColors) {
                if (mat.color) mat.color.setHex(color);
            }
        }, 100);

        return this.health;
    }

    update(deltaTime) {
        const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.25;
        if (this.coreLight) this.coreLight.intensity = 4 * pulse;
        if (this.fillLight) this.fillLight.intensity = 2.2 * pulse;
    }

    isDestroyed() {
        return this.health <= 0;
    }

    /**
     * Get collision radius for the base
     */
    getCollisionRadius() {
        return this.collisionRadius;
    }

    /**
     * Get the top height of the base
     */
    getTopHeight() {
        return this.height;
    }
}

/**
 * EnemyTower - The large menacing spire the Skibidi horde pours out of.
 * Purely structural/atmospheric: it doesn't take damage, but it sits in the
 * scene geometry so bullets bounce off it, and enemies spawn around its base.
 */
class EnemyTower {
    /**
     * Preload the enemy castle GLB before any EnemyTower is constructed.
     * onComplete is always called (even on error, so the game can use the fallback).
     */
    static preload(onComplete) {
        if (EnemyTower.modelTemplate) {
            onComplete();
            return;
        }

        const LoaderCtor = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
            ? THREE.GLTFLoader
            : (typeof GLTFLoader !== 'undefined' ? GLTFLoader : null);

        if (!LoaderCtor) {
            console.warn('GLTFLoader not available — enemy castle will use fallback geometry.');
            onComplete();
            return;
        }

        const loader = new LoaderCtor();
        loader.load(
            'assets/Level/Ennemy_Castle_1.glb',
            (gltf) => {
                EnemyTower.modelTemplate = gltf.scene;
                EnemyTower.modelTemplate.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                console.log('Enemy castle model preloaded successfully!');
                onComplete();
            },
            undefined,
            (error) => {
                console.warn('Could not preload enemy castle, will use fallback geometry:', error);
                onComplete();
            }
        );
    }

    constructor(scene, config = null) {
        this.scene = scene;
        const cfg = config || {};
        this.position = new THREE.Vector3(cfg.x ?? 0, cfg.y ?? 0, cfg.z ?? -16);
        this.radius = cfg.radius ?? 5;
        this.height = cfg.height ?? 17;
        this.mesh = null;
        this.portalLight = null;

        this.createMesh();
    }

    createMesh() {
        if (EnemyTower.modelTemplate) {
            this.createModelMesh();
        } else {
            this.createFallbackMesh();
        }
        this._addPortalLight(this.mesh);
    }

    _prepareModelMaterials(root) {
        const env = this.scene.getScene?.()?.environment ?? null;
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.visible = true;
            child.frustumCulled = false;
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.geometry) {
                child.geometry.computeBoundingBox();
                child.geometry.computeBoundingSphere();
            }
            const srcMats = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = srcMats.map((m) => (m ? m.clone() : m));
            child.material = cloned.length === 1 ? cloned[0] : cloned;
            for (const mat of cloned) {
                if (!mat) continue;
                if (env && mat.isMeshStandardMaterial) {
                    mat.envMap = env;
                    mat.envMapIntensity = 1.2;
                }
                if (mat.emissive) {
                    if (mat.emissive.r + mat.emissive.g + mat.emissive.b < 0.05) {
                        mat.emissive.setHex(0x331111);
                    }
                    mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 0.35);
                }
                if (typeof mat.roughness === 'number') mat.roughness = Math.min(mat.roughness, 0.92);
            }
        });
    }

    createModelMesh() {
        this.mesh = new THREE.Group();

        const model = EnemyTower.modelTemplate.clone(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const preMinY = box.min.y;
        const footRadius = Math.max(size.x, size.z) * 0.5 || 1;

        // Uniform scale from authored height — preserves the GLB's aspect ratio.
        const s = this.height / (size.y || 1);
        model.scale.setScalar(s);
        model.position.y = -preMinY * s;

        // Collision cylinder follows the proportionally scaled footprint.
        this.radius = footRadius * s;

        this._prepareModelMaterials(model);
        this.mesh.add(model);

        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z)
            : this.position.y;
        this.mesh.position.set(this.position.x, groundY, this.position.z);

        this.scene.addToScene(this.mesh);
    }

    _addPortalLight(group) {
        const h = this.height;
        const r = this.radius;
        this.portalLight = new THREE.PointLight(0xff2200, 3.5, r * 10);
        this.portalLight.position.set(0, h * 0.25, r * 0.9);
        group.add(this.portalLight);
    }

    createFallbackMesh() {
        const group = new THREE.Group();
        const r = this.radius;
        const h = this.height;

        // Main spire body — wide at the base, tapering toward the top.
        const bodyGeometry = new THREE.CylinderGeometry(r * 0.55, r, h, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x2a2a32,
            roughness: 0.95,
            metalness: 0.15,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = h / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Flared base ring so it reads as planted in the ground.
        const baseGeometry = new THREE.CylinderGeometry(r * 1.15, r * 1.4, h * 0.12, 8);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x202026,
            roughness: 0.95,
            metalness: 0.1,
            flatShading: true
        });
        const baseRing = new THREE.Mesh(baseGeometry, baseMaterial);
        baseRing.position.y = h * 0.06;
        baseRing.castShadow = true;
        baseRing.receiveShadow = true;
        group.add(baseRing);

        // Glowing red spawn portal facing the arena (toward +z / the base).
        const portalGeometry = new THREE.CircleGeometry(r * 0.5, 16);
        const portalMaterial = new THREE.MeshStandardMaterial({
            color: 0xff2200,
            emissive: 0xff2200,
            emissiveIntensity: 1.2,
            roughness: 0.4,
            metalness: 0.2,
            side: THREE.DoubleSide
        });
        const portal = new THREE.Mesh(portalGeometry, portalMaterial);
        portal.position.set(0, h * 0.22, r * 0.92);
        group.add(portal);

        // Menacing crown of spikes around the top — tarnished gold to echo
        // the Skibidi King's crown.
        const spikeMaterial = new THREE.MeshStandardMaterial({
            color: 0x8a6f2b,
            roughness: 0.5,
            metalness: 0.85,
            emissive: 0x3a2800,
            emissiveIntensity: 0.3,
            flatShading: true
        });
        const spikeCount = 8;
        for (let i = 0; i < spikeCount; i++) {
            const spike = new THREE.Mesh(
                new THREE.ConeGeometry(r * 0.18, h * 0.22, 5),
                spikeMaterial
            );
            const angle = (i / spikeCount) * Math.PI * 2;
            spike.position.set(
                Math.cos(angle) * r * 0.55,
                h + h * 0.06,
                Math.sin(angle) * r * 0.55
            );
            spike.castShadow = true;
            group.add(spike);
        }

        // Glowing core at the apex.
        const coreGeometry = new THREE.SphereGeometry(r * 0.35, 10, 10);
        const coreMaterial = new THREE.MeshStandardMaterial({
            color: 0xff3300,
            emissive: 0xff3300,
            emissiveIntensity: 0.9,
            roughness: 0.3,
            metalness: 0.6
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.y = h + h * 0.02;
        group.add(core);

        this.mesh = group;
        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z)
            : this.position.y;
        this.mesh.position.set(this.position.x, groundY, this.position.z);

        this.scene.addToScene(this.mesh);
    }

    update(deltaTime) {
        if (this.portalLight) {
            this.portalLight.intensity = 3.5 + Math.sin(Date.now() * 0.004) * 0.8;
        }
    }
}

/**
 * Enemy - Skibidi Toilet enemy
 */
class Enemy {
    constructor(scene, spawnPosition, target) {
        this.scene = scene;
        this.target = target; // The base position
        this.position = spawnPosition.clone();
        this.velocity = new THREE.Vector3();
        this.mesh = null;

        // Stats
        this.maxHealth = 30;
        this.health = this.maxHealth;
        this.speed = 2 + Math.random() * 1; // Varied speed
        this.baseSpeed = this.speed;        // unmodified speed (freeze/shock scale this)
        this.damage = 10;
        this.attackCooldown = 1.0; // seconds
        this.lastAttackTime = 0;
        this.lastPlayerAttackTime = -999; // separate cadence for hitting the player
        this.isAlive = true;

        // Combat extras driven by the ported ZombieBlaster weapon FX.
        this.hitRadius = 0.7;                       // projectile/melee footprint
        this.knockbackVel = new THREE.Vector3();    // transient shove, decays each frame
        this.scoreValue = 100;
        this.lastWeaponIndex = 0;                   // weapon that last damaged us (for kill FX)
        // Active status timers (seconds remaining) + damage-over-time rates.
        this.status = { burn: 0, burnDps: 0, corrode: 0, corrodeDps: 0, freeze: 0, shock: 0 };

        this.createMesh();
    }

    /**
     * Preload the enemy GLB model and store it as a reusable template.
     * Call this once during the game loading phase before any enemies spawn.
     * onComplete is always called (even on error, so the game can use the fallback).
     */
    static preload(onComplete) {
        if (Enemy.modelTemplate) {
            onComplete();
            return;
        }

        const LoaderCtor = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
            ? THREE.GLTFLoader
            : (typeof GLTFLoader !== 'undefined' ? GLTFLoader : null);

        if (!LoaderCtor) {
            console.warn('GLTFLoader not available — enemies will use fallback geometry.');
            onComplete();
            return;
        }

        const loader = new LoaderCtor();
        loader.load(
            'assets/models/Skibidi_ennemy.glb',
            (gltf) => {
                Enemy.modelTemplate = gltf.scene;
                Enemy.modelTemplate.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                console.log('Enemy model preloaded successfully!');
                onComplete();
            },
            undefined,
            (error) => {
                console.warn('Could not preload enemy model, will use fallback geometry:', error);
                onComplete();
            }
        );
    }

    createMesh() {
        if (Enemy.modelTemplate) {
            // Synchronous — use the preloaded template clone (no race condition)
            this.mesh = Enemy.modelTemplate.clone();
            this.mesh.scale.set(1.5, 1.5, 1.5);
            this.mesh.position.copy(this.position);
            this.scene.addToScene(this.mesh);
        } else {
            // Fallback to procedural geometry if preload was skipped or failed
            this.createFallbackMesh();
        }
    }

    createFallbackMesh() {
        const group = new THREE.Group();

        // Toilet bowl base (main body)
        const bowlGeometry = new THREE.CylinderGeometry(0.6, 0.8, 1, 8);
        const bowlMaterial = new THREE.MeshStandardMaterial({
            color: 0xC0C0C0,
            roughness: 0.7,
            metalness: 0.3,
            flatShading: true
        });
        const bowl = new THREE.Mesh(bowlGeometry, bowlMaterial);
        bowl.position.y = 0.5;
        bowl.castShadow = true;
        group.add(bowl);

        // Toilet lid/head
        const lidGeometry = new THREE.BoxGeometry(1, 0.3, 0.8);
        const lidMaterial = new THREE.MeshStandardMaterial({
            color: 0x404040,
            roughness: 0.8,
            metalness: 0.1,
            flatShading: true
        });
        const lid = new THREE.Mesh(lidGeometry, lidMaterial);
        lid.position.y = 1.3;
        lid.rotation.x = -0.3; // Slight tilt
        lid.castShadow = true;
        group.add(lid);

        // Eyes (gold accents)
        const eyeGeometry = new THREE.SphereGeometry(0.1, 6, 6);
        const eyeMaterial = new THREE.MeshStandardMaterial({
            color: 0xFFD700,
            emissive: 0xFFD700,
            emissiveIntensity: 0.5
        });

        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.25, 1.3, 0.4);
        group.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.25, 1.3, 0.4);
        group.add(rightEye);

        this.mesh = group;
        this.mesh.position.copy(this.position);

        this.scene.addToScene(this.mesh);
    }

    /** Red ring + marker visible in the iso overwatch / build view. */
    setOverwatchVisible(visible) {
        if (!this.mesh) return;
        if (!this._overwatchMarker) {
            const marker = new THREE.Group();
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.45, 0.85, 14),
                new THREE.MeshBasicMaterial({
                    color: 0xff3344,
                    transparent: true,
                    opacity: 0.92,
                    depthWrite: false,
                    fog: false,
                })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.18;
            ring.renderOrder = 25;
            marker.add(ring);

            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.32, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xff6677, fog: false })
            );
            dot.position.y = 1.05;
            dot.renderOrder = 25;
            marker.add(dot);

            this.mesh.add(marker);
            this._overwatchMarker = marker;
        }
        this._overwatchMarker.visible = visible;
    }

    // Transient shove away from a hit (ported weapon FX). Accumulates into a
    // velocity that decays in update().
    applyKnockback(dir, strength) {
        if (!dir || !strength) return;
        this.knockbackVel.addScaledVector(dir, strength);
    }

    // Apply/refresh a status effect. burn/corrode tick damage-over-time;
    // freeze/shock slow movement while active.
    applyStatus(type, duration, dps = 0) {
        if (!type) return;
        switch (type) {
            case 'burn': this.status.burn = Math.max(this.status.burn, duration); this.status.burnDps = dps; break;
            case 'corrode': this.status.corrode = Math.max(this.status.corrode, duration); this.status.corrodeDps = dps; break;
            case 'freeze': this.status.freeze = Math.max(this.status.freeze, duration); break;
            case 'shock': this.status.shock = Math.max(this.status.shock, duration); break;
        }
    }

    update(deltaTime, baseRadius = 2.5) {
        if (!this.isAlive || !this.mesh) return;

        // --- Status timers + damage-over-time (may kill the enemy) ---
        let speedMul = 1;
        if (this.status.freeze > 0) { this.status.freeze -= deltaTime; speedMul *= 0.4; }
        if (this.status.shock > 0) { this.status.shock -= deltaTime; speedMul *= 0.5; }
        if (this.status.burn > 0) {
            this.status.burn -= deltaTime;
            this.takeDamage(this.status.burnDps * deltaTime, true);
        }
        if (this.isAlive && this.status.corrode > 0) {
            this.status.corrode -= deltaTime;
            this.takeDamage(this.status.corrodeDps * deltaTime, true);
        }
        if (!this.isAlive) return; // died from DoT this frame

        // Move toward target
        const direction = new THREE.Vector3()
            .subVectors(this.target, this.position)
            .normalize();

        this.velocity = direction.multiplyScalar(this.baseSpeed * speedMul);

        // Calculate new position (movement + decaying knockback)
        const newPosition = this.position.clone()
            .add(this.velocity.clone().multiplyScalar(deltaTime))
            .add(this.knockbackVel.clone().multiplyScalar(deltaTime));
        this.knockbackVel.multiplyScalar(0.85);
        if (this.knockbackVel.lengthSq() < 0.0004) this.knockbackVel.set(0, 0, 0);

        // Check collision with tower (cylindrical collision)
        const distanceToCenter = Math.sqrt(newPosition.x * newPosition.x + newPosition.z * newPosition.z);

        if (distanceToCenter < baseRadius) {
            // Enemy is trying to enter the tower - stop at the edge
            // Push them to just outside the tower radius
            const angle = Math.atan2(newPosition.z, newPosition.x);
            newPosition.x = Math.cos(angle) * baseRadius;
            newPosition.z = Math.sin(angle) * baseRadius;
        }

        this.position.copy(newPosition);

        // Update mesh position
        this.mesh.position.copy(this.position);

        // Face movement direction
        const angle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = angle;

        // Bobbing animation, riding the terrain surface beneath the enemy.
        const groundY = this.scene.getGroundHeight
            ? this.scene.getGroundHeight(this.position.x, this.position.z) : 0;
        this.mesh.position.y = groundY + 1.27 + Math.abs(Math.sin(Date.now() * 0.005)) * 0.2;
    }

    // Player-attack cadence (separate from the base-attack timer).
    canAttackPlayer(currentTime) {
        return (currentTime - this.lastPlayerAttackTime) >= this.attackCooldown;
    }
    attackPlayer(currentTime) {
        this.lastPlayerAttackTime = currentTime;
        return this.damage;
    }

    takeDamage(amount, silent = false) {
        this.health -= amount;

        // Flash white on hit (works with GLB models). DoT ticks pass silent=true
        // so the enemy doesn't strobe every frame while burning/corroding.
        if (!silent && this.mesh) {
            this.mesh.traverse(child => {
                if (child.isMesh && child.material) {
                    const originalColor = child.material.color ? child.material.color.getHex() : 0xFFFFFF;
                    if (child.material.color) {
                        child.material.color.setHex(0xFFFFFF);

                        setTimeout(() => {
                            if (child.material && child.material.color) {
                                child.material.color.setHex(originalColor);
                            }
                        }, 50);
                    }
                }
            });
        }

        if (this.health <= 0) {
            this.die();
        }

        return this.health;
    }

    die() {
        this.isAlive = false;

        if (!this.mesh) return;

        // Death animation - scale down and fade
        const originalScale = this.mesh.scale.clone();
        let scale = 1;
        const deathAnimation = setInterval(() => {
            scale -= 0.1;
            if (scale <= 0 || !this.mesh) {
                clearInterval(deathAnimation);
                if (this.mesh) {
                    this.scene.removeFromScene(this.mesh);
                }
            } else {
                this.mesh.scale.set(
                    originalScale.x * scale,
                    originalScale.y * scale,
                    originalScale.z * scale
                );
            }
        }, 30);
    }

    canAttack(currentTime) {
        return (currentTime - this.lastAttackTime) >= this.attackCooldown;
    }

    attack(currentTime) {
        this.lastAttackTime = currentTime;
        return this.damage;
    }

    distanceToTarget() {
        return this.position.distanceTo(this.target);
    }
}

// Static templates — populated by preload() before instances are constructed.
DefenseBase.modelTemplate = null;
EnemyTower.modelTemplate = null;
Enemy.modelTemplate = null;

/**
 * Weapon - Player's rifle (FPS viewmodel)
 */
class Weapon {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.mesh = null;
        this.muzzleFlash = null;

        // Weapon stats
        this.damage = 15;
        this.fireRate = 0.15; // seconds between shots
        this.lastFireTime = 0;
        this.recoil = 0;

        this.createMesh();
    }

    createMesh() {
        const group = new THREE.Group();

        // Weapon body (rectangular rifle shape)
        const bodyGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x303030,
            roughness: 0.8,
            metalness: 0.3,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.z = -0.4;
        group.add(body);

        // Barrel
        const barrelGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);
        const barrelMaterial = new THREE.MeshStandardMaterial({
            color: 0x505050,
            roughness: 0.6,
            metalness: 0.6
        });
        const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.05, -0.9);
        group.add(barrel);

        // Accent detail (orange)
        const accentGeometry = new THREE.BoxGeometry(0.08, 0.06, 0.15);
        const accentMaterial = new THREE.MeshStandardMaterial({
            color: 0xFF4500,
            roughness: 0.4,
            metalness: 0.6
        });
        const accent = new THREE.Mesh(accentGeometry, accentMaterial);
        accent.position.set(0, 0.08, -0.5);
        group.add(accent);

        // Muzzle flash (initially hidden)
        const flashGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFD700,
            transparent: true,
            opacity: 0
        });
        this.muzzleFlash = new THREE.Mesh(flashGeometry, flashMaterial);
        this.muzzleFlash.position.set(0, 0.05, -1.1);
        group.add(this.muzzleFlash);

        // Position weapon in front of camera
        group.position.set(0.3, -0.3, -0.5);

        this.mesh = group;
        this.camera.add(this.mesh);
    }

    canFire(currentTime) {
        return (currentTime - this.lastFireTime) >= this.fireRate;
    }

    fire(currentTime) {
        this.lastFireTime = currentTime;

        // Muzzle flash effect
        this.showMuzzleFlash();

        // Recoil animation
        this.recoil = 0.05;

        return true;
    }

    showMuzzleFlash() {
        if (!this.muzzleFlash) return;

        this.muzzleFlash.material.opacity = 1;
        this.muzzleFlash.scale.set(2, 2, 2);

        setTimeout(() => {
            if (this.muzzleFlash) {
                this.muzzleFlash.material.opacity = 0;
            }
        }, 50);
    }

    update(deltaTime) {
        // Smooth recoil recovery
        if (this.recoil > 0) {
            this.recoil -= deltaTime * 0.5;
            this.recoil = Math.max(0, this.recoil);
        }

        // Apply recoil to weapon position
        this.mesh.position.z = -0.5 + this.recoil;
    }
}

/**
 * Projectile - Visual bullet projectile with physics and bouncing
 */
class BulletTrail {
    constructor(scene, startPos, endPos, hitEnemy = false, sceneGeometry = []) {
        this.scene = scene;
        this.startPos = startPos.clone();
        this.endPos = endPos.clone();
        this.currentPos = startPos.clone();

        // Physics properties
        this.velocity = new THREE.Vector3().subVectors(endPos, startPos).normalize();
        this.speed = 80; // Bullet initial speed
        this.velocity.multiplyScalar(this.speed);
        this.gravity = -30; // Increased gravity - heavier bullets
        this.lifetime = 3.0; // Max lifetime in seconds
        this.age = 0;

        // Bounce properties
        this.bounceCount = 0;
        this.maxBounces = 3;
        this.bounceDamping = 0.35; // Less energy retained (35%) - lower bounces
        this.groundLevel = 0;

        // Hit detection
        this.hitEnemy = hitEnemy;
        this.sceneGeometry = sceneGeometry; // All meshes to collide with
        this.raycaster = new THREE.Raycaster();

        this.mesh = null;

        this.createBullet();
    }

    createBullet() {
        // Create a visible bullet projectile (optimized - using basic material)
        const geometry = new THREE.SphereGeometry(0.12, 6, 6);
        const material = new THREE.MeshBasicMaterial({
            color: 0xFFFF00,
            transparent: true,
            opacity: 0.9
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.startPos);

        this.scene.addToScene(this.mesh);
    }

    update(deltaTime) {
        this.age += deltaTime;

        // If bullet hit an enemy, disappear immediately
        if (this.hitEnemy) {
            return false;
        }

        // Check lifetime
        if (this.age >= this.lifetime) {
            return false;
        }

        // Check if max bounces reached
        if (this.bounceCount >= this.maxBounces) {
            return false;
        }

        // Apply gravity to vertical velocity
        this.velocity.y += this.gravity * deltaTime;

        // Calculate new position
        const newPos = this.currentPos.clone();
        newPos.x += this.velocity.x * deltaTime;
        newPos.y += this.velocity.y * deltaTime;
        newPos.z += this.velocity.z * deltaTime;

        // Check collision with scene geometry using raycast
        const direction = new THREE.Vector3().subVectors(newPos, this.currentPos).normalize();
        const distance = this.currentPos.distanceTo(newPos);

        this.raycaster.set(this.currentPos, direction);
        this.raycaster.far = distance;

        const intersections = this.raycaster.intersectObjects(this.sceneGeometry, true);

        if (intersections.length > 0) {
            const hit = intersections[0];

            // Calculate bounce direction
            const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);

            // Transform normal to world space
            if (hit.object.matrixWorld) {
                normal.transformDirection(hit.object.matrixWorld);
            }
            normal.normalize();

            // Reflect velocity around normal
            const dotProduct = this.velocity.dot(normal);
            this.velocity.sub(normal.multiplyScalar(2 * dotProduct));

            // Apply damping
            this.velocity.multiplyScalar(this.bounceDamping);

            // Move bullet to collision point with small offset
            this.currentPos.copy(hit.point).add(normal.multiplyScalar(0.01));

            this.bounceCount++;

            // Stop if velocity is too low
            if (this.velocity.length() < 3 && this.bounceCount > 0) {
                return false;
            }
        } else {
            // No collision, update position normally
            this.currentPos.copy(newPos);

            // Check if bullet hit ground (fallback)
            if (this.currentPos.y <= this.groundLevel) {
                // Bounce off ground
                this.currentPos.y = this.groundLevel;
                this.velocity.y = Math.abs(this.velocity.y) * this.bounceDamping;
                this.velocity.x *= this.bounceDamping;
                this.velocity.z *= this.bounceDamping;
                this.bounceCount++;

                // Stop if velocity is too low
                if (Math.abs(this.velocity.y) < 2 && this.bounceCount > 0) {
                    return false;
                }
            }
        }

        this.mesh.position.copy(this.currentPos);

        return true;
    }

    // Mark bullet as having hit an enemy
    markEnemyHit() {
        this.hitEnemy = true;
    }

    destroy() {
        if (this.mesh) {
            // Properly dispose of geometry and material
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
            this.scene.removeFromScene(this.mesh);
            this.mesh = null;
        }
    }
}

/**
 * ParticleEffect - Optimized particle system for hits and explosions
 */
class ParticleEffect {
    constructor(scene, position, color = 0xFFD700, count = 5) {
        this.scene = scene;
        this.lifetime = 0.3; // Shorter lifetime
        this.age = 0;
        this.mesh = null;

        this.createParticles(position, color, count);
    }

    createParticles(position, color, count) {
        // Use Points for much better performance
        const vertices = [];
        const velocities = [];

        for (let i = 0; i < count; i++) {
            // Initial position
            vertices.push(position.x, position.y, position.z);

            // Random velocity
            velocities.push(
                (Math.random() - 0.5) * 3,
                Math.random() * 3,
                (Math.random() - 0.5) * 3
            );
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

        const material = new THREE.PointsMaterial({
            color: color,
            size: 0.2,
            transparent: true,
            opacity: 1,
            sizeAttenuation: true
        });

        this.mesh = new THREE.Points(geometry, material);
        this.velocities = velocities;
        this.scene.addToScene(this.mesh);
    }

    update(deltaTime) {
        this.age += deltaTime;

        if (!this.mesh) return false;

        // Update positions
        const positions = this.mesh.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            const vIndex = i;

            // Apply velocity
            positions[i] += this.velocities[vIndex] * deltaTime;
            positions[i + 1] += this.velocities[vIndex + 1] * deltaTime;
            positions[i + 2] += this.velocities[vIndex + 2] * deltaTime;

            // Apply gravity
            this.velocities[vIndex + 1] -= 9.8 * deltaTime;
        }
        this.mesh.geometry.attributes.position.needsUpdate = true;

        // Fade out
        this.mesh.material.opacity = 1 - (this.age / this.lifetime);

        // Cleanup when done
        if (this.age >= this.lifetime) {
            this.destroy();
            return false;
        }

        return true;
    }

    destroy() {
        if (this.mesh) {
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
            this.scene.removeFromScene(this.mesh);
            this.mesh = null;
        }
    }
}
