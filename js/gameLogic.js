/**
 * gameLogic.js - Game Logic and Systems
 * Handles wave management, enemy spawning, combat mechanics
 */

class GameLogic {
    constructor(scene, base, levelData = null) {
        this.scene = scene;
        this.base = base;

        // Designer-placed spawn points (x/z pairs). When empty the spawner
        // falls back to a random angle around spawnRadius, matching the
        // original gameplay.
        this.enemySpawns = (levelData && levelData.enemySpawns) || [];
        // Optional per-wave config (enemyCount, spawnInterval). When the
        // array is shorter than the current wave number, the progressive
        // difficulty curve below kicks in.
        this.waveConfig = (levelData && levelData.waves) || [];

        // Wave system
        this.currentWave = 0;
        this.maxWaves = 10;
        this.enemiesInWave = 0;
        this.enemiesSpawned = 0;
        this.enemiesAlive = 0;
        this.waveActive = false;
        this.waveDelay = 5; // seconds between waves
        this.nextWaveTime = 0;
        this.spawnInterval = 1.5; // seconds between enemy spawns
        this.lastSpawnTime = 0;

        // Enemy management
        this.enemies = [];
        this.maxActiveEnemies = 32;

        // Enemies now pour in from ALL directions around the field. Spawn just
        // inside the rim so they're visible marching in. Scales with the arena.
        const arenaSize = (levelData && levelData.arena && levelData.arena.size) || 80;
        this.spawnRadius = arenaSize / 2 - 3;

        // Optional hook: called once per enemy death (any cause). game.js uses
        // it to drop a collectable coin at the death position.
        this.onEnemyKilled = null;

        // Stats
        this.totalKills = 0;
        this.score = 0; // drives ported weapon evolution tiers
        this.acidTickTimer = 0;

        // Visual effects
        this.effects = [];
        this.maxEffects = 50; // Limit active effects for performance

        // Collect scene geometry for bullet collision
        this.sceneGeometry = this.collectSceneGeometry();
    }

    /**
     * Collect all meshes in the scene for bullet collision
     */
    collectSceneGeometry() {
        const geometry = [];

        // Get arena mesh from scene
        const sceneObject = this.scene.getScene();
        if (sceneObject) {
            sceneObject.traverse((child) => {
                // Skip shader-driven meshes (sky dome + the full-screen lens-flare
                // quad at the origin) — they're backdrop, not bullet colliders.
                if (child.isMesh && !(child.material && child.material.isShaderMaterial)) {
                    geometry.push(child);
                }
            });
        }

        // Add base mesh
        if (this.base && this.base.mesh) {
            this.base.mesh.traverse((child) => {
                if (child.isMesh) {
                    geometry.push(child);
                }
            });
        }

        return geometry;
    }

    /**
     * Start a new wave
     */
    startWave() {
        this.currentWave++;
        this.waveActive = true;

        // Authored config wins; otherwise fall back to progressive curve.
        // Steeper ramp (≈ wave 1: 7 → wave 10: 33) so each level brings notably
        // more Skibidi than your turret line can fully cover on its own.
        const cfg = this.waveConfig[this.currentWave - 1];
        this.enemiesInWave = cfg?.enemyCount ?? Math.round(5 + this.currentWave * 2.8);
        this.spawnInterval = cfg?.spawnInterval ?? this.spawnInterval;
        this.enemiesSpawned = 0;
        this.lastSpawnTime = Date.now() / 1000;

        console.log(`Wave ${this.currentWave} started! Enemies: ${this.enemiesInWave}`);
    }

    /**
     * Spawn an enemy at a random position around the perimeter
     */
    spawnEnemy() {
        if (this.enemies.length >= this.maxActiveEnemies) return;
        if (this.enemiesSpawned >= this.enemiesInWave) return;

        // Spawn from a random direction anywhere around the field, with a bit
        // of radius jitter so they don't form a perfect ring.
        const angle = Math.random() * Math.PI * 2;
        const radius = this.spawnRadius - Math.random() * 4;
        const spawnPos = new THREE.Vector3(
            Math.cos(angle) * radius,
            0,
            Math.sin(angle) * radius
        );

        const enemy = new Enemy(this.scene, spawnPos, this.base.position);

        // Difficulty ramp: each wave the horde is tougher and a touch faster,
        // so the threat keeps outgrowing your slowly-expanding turret line.
        const w = this.currentWave;
        const hpScale = 1 + (w - 1) * 0.14;
        const speedScale = Math.min(1.6, 1 + (w - 1) * 0.035);
        enemy.maxHealth = Math.round(enemy.maxHealth * hpScale);
        enemy.health = enemy.maxHealth;
        enemy.baseSpeed *= speedScale;
        enemy.speed = enemy.baseSpeed;

        this.enemies.push(enemy);
        this.enemiesSpawned++;
        this.enemiesAlive++;
    }

    /**
     * Check if wave is complete
     */
    isWaveComplete() {
        return this.enemiesSpawned >= this.enemiesInWave && this.enemiesAlive === 0;
    }

    /**
     * Handle raycast shooting
     */
    shoot(camera, weapon) {
        const currentTime = Date.now() / 1000;

        if (!weapon.canFire(currentTime)) {
            return null;
        }

        weapon.fire(currentTime);

        // Raycast from camera center
        const raycaster = new THREE.Raycaster();
        const center = new THREE.Vector2(0, 0); // Screen center
        raycaster.setFromCamera(center, camera);

        // Check for hits
        let hitEnemy = null;
        let minDistance = Infinity;

        this.enemies.forEach(enemy => {
            if (!enemy.isAlive) return;

            const intersects = raycaster.intersectObject(enemy.mesh, true);
            if (intersects.length > 0) {
                const distance = intersects[0].distance;
                if (distance < minDistance) {
                    minDistance = distance;
                    hitEnemy = enemy;
                }
            }
        });

        // Create bullet trail
        const startPos = camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(camera.quaternion);

        let endPos;
        if (hitEnemy) {
            endPos = hitEnemy.position.clone();
            endPos.y += 0.5; // Aim for center mass
        } else {
            endPos = startPos.clone().add(direction.multiplyScalar(100));
        }

        // Create bullet with scene geometry for collision detection
        const trail = new BulletTrail(this.scene, startPos, endPos, false, this.sceneGeometry);
        this.effects.push(trail);

        // Apply damage
        if (hitEnemy) {
            // Mark bullet as hitting enemy so it disappears instead of bouncing
            trail.markEnemyHit();

            hitEnemy.takeDamage(weapon.damage);

            // Hit effect (reduced particles)
            const hitEffect = new ParticleEffect(
                this.scene,
                hitEnemy.position.clone().add(new THREE.Vector3(0, 0.5, 0)),
                0xFF4500,
                3
            );
            this.effects.push(hitEffect);

            if (!hitEnemy.isAlive) {
                this.totalKills++;
                this.enemiesAlive--;

                // Death explosion (reduced particles)
                const deathEffect = new ParticleEffect(
                    this.scene,
                    hitEnemy.position.clone(),
                    0xFFD700,
                    5
                );
                this.effects.push(deathEffect);
            }

            return hitEnemy;
        }

        return null;
    }

    /**
     * Update game logic
     */
    update(deltaTime, ctx = {}) {
        const currentTime = Date.now() / 1000;

        // Update base
        this.base.update(deltaTime);

        // Wave management
        if (!this.waveActive && this.currentWave < this.maxWaves) {
            if (currentTime >= this.nextWaveTime) {
                this.startWave();
            }
        }

        // Enemy spawning during active wave
        if (this.waveActive && this.enemiesSpawned < this.enemiesInWave) {
            if (currentTime - this.lastSpawnTime >= this.spawnInterval) {
                this.spawnEnemy();
                this.lastSpawnTime = currentTime;
            }
        }

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];

            if (!enemy.isAlive) {
                // Central kill accounting — covers both projectile kills and
                // damage-over-time (burn/corrode) kills, so score/kills stay
                // consistent regardless of how the enemy died.
                if (!enemy._killCounted) {
                    enemy._killCounted = true;
                    this.totalKills++;
                    this.enemiesAlive--;
                    this.score += enemy.scoreValue;
                    // Drop a coin the player can collect on foot (FPS view).
                    if (this.onEnemyKilled) this.onEnemyKilled(enemy);
                }
                this.enemies.splice(i, 1);
                continue;
            }

            // Update enemy with tower collision
            const baseRadius = this.base.getCollisionRadius();
            enemy.update(deltaTime, baseRadius);

            // Check if enemy reached the base (at collision radius)
            const distanceToBase = enemy.distanceToTarget();
            if (distanceToBase <= baseRadius) {
                if (enemy.canAttack(currentTime)) {
                    const damage = enemy.attack(currentTime);
                    this.base.takeDamage(damage);

                    // Visual feedback (reduced particles)
                    const attackEffect = new ParticleEffect(
                        this.scene,
                        this.base.position.clone().add(new THREE.Vector3(0, 2, 0)),
                        0xFF0000,
                        4
                    );
                    this.effects.push(attackEffect);
                }
            }

            // Enemies also claw the player when they get close enough (ported
            // survival mechanic — player now has health).
            if (ctx.playerPosition && ctx.onPlayerAttacked) {
                const dx = enemy.position.x - ctx.playerPosition.x;
                const dz = enemy.position.z - ctx.playerPosition.z;
                const reach = (enemy.hitRadius ?? 0.7) + 0.6;
                if (dx * dx + dz * dz <= reach * reach && enemy.canAttackPlayer(currentTime)) {
                    enemy.attackPlayer(currentTime);
                    ctx.onPlayerAttacked(enemy.damage);
                }
            }
        }

        // Acid-pool damage ticks: enemies standing in an active Soda-Laser pool
        // take dps over time (ported from ZombieBlaster's applyAcidPoolTicks).
        this.updateAcidPools(deltaTime);

        // Update visual effects
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            const stillAlive = effect.update(deltaTime);

            if (!stillAlive) {
                if (effect.destroy) effect.destroy();
                this.effects.splice(i, 1);
            }
        }

        // Limit number of active effects for performance
        while (this.effects.length > this.maxEffects) {
            const oldEffect = this.effects.shift();
            if (oldEffect && oldEffect.destroy) {
                oldEffect.destroy();
            }
        }

        // Check if wave is complete
        if (this.waveActive && this.isWaveComplete()) {
            this.waveActive = false;
            this.nextWaveTime = currentTime + this.waveDelay;
            console.log(`Wave ${this.currentWave} complete! Next wave in ${this.waveDelay}s`);
        }
    }

    /**
     * Tick acid pools left by the Soda Laser. Any enemy inside an active pool
     * takes dps * interval damage with the corrode status refreshed.
     */
    updateAcidPools(deltaTime) {
        if (typeof ZBEffects === 'undefined' || !ZBEffects.getActiveAcidPools) return;
        const TICK = 0.25;
        const pools = ZBEffects.getActiveAcidPools();
        if (pools.length === 0) return;
        pools.forEach(pool => {
            if (pool.tickTimer < TICK) return;
            pool.tickTimer = 0;
            const r2 = pool.radius * pool.radius;
            this.enemies.forEach(enemy => {
                if (!enemy.isAlive) return;
                const dx = enemy.position.x - pool.position.x;
                const dz = enemy.position.z - pool.position.z;
                if (dx * dx + dz * dz > r2) return;
                enemy.applyStatus('corrode', 0.6, 0);
                enemy.takeDamage(pool.dps * TICK, true);
            });
        });
    }

    /**
     * Check win condition
     */
    hasWon() {
        return this.currentWave >= this.maxWaves && this.isWaveComplete();
    }

    /**
     * Check lose condition
     */
    hasLost() {
        return this.base.isDestroyed();
    }

    /**
     * Get game statistics
     */
    getStats() {
        return {
            wave: this.currentWave,
            maxWaves: this.maxWaves,
            baseHealth: this.base.health,
            maxBaseHealth: this.base.maxHealth,
            enemiesAlive: this.enemiesAlive,
            totalKills: this.totalKills,
            score: this.score,
            isWaveActive: this.waveActive,
            timeUntilNextWave: this.waveActive ? 0 : Math.max(0, this.nextWaveTime - Date.now() / 1000)
        };
    }

    /**
     * Reset game state
     */
    reset() {
        // Clear all enemies
        this.enemies.forEach(enemy => {
            if (enemy.mesh) {
                this.scene.removeFromScene(enemy.mesh);
            }
        });
        this.enemies = [];

        // Clear effects
        this.effects.forEach(effect => {
            if (effect.destroy) {
                effect.destroy();
            }
        });
        this.effects = [];

        // Reset wave system
        this.currentWave = 0;
        this.enemiesInWave = 0;
        this.enemiesSpawned = 0;
        this.enemiesAlive = 0;
        this.waveActive = false;
        this.nextWaveTime = Date.now() / 1000 + 3; // 3 seconds until first wave

        // Reset stats
        this.totalKills = 0;
        this.score = 0;

        // Reset base
        this.base.health = this.base.maxHealth;

        console.log('Game logic reset');
    }
}
