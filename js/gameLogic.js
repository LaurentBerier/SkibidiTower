/**
 * gameLogic.js - Game Logic and Systems
 * Handles wave management, enemy spawning, combat mechanics
 */

class GameLogic {
    constructor(scene, base) {
        this.scene = scene;
        this.base = base;

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
        this.maxActiveEnemies = 20;

        // Spawn positions (around arena perimeter)
        this.spawnRadius = 18;

        // Stats
        this.totalKills = 0;

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
                if (child.isMesh) {
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

        // Calculate enemies for this wave (progressive difficulty)
        this.enemiesInWave = Math.floor(5 + this.currentWave * 2);
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

        // Random angle around arena
        const angle = Math.random() * Math.PI * 2;
        const spawnPos = new THREE.Vector3(
            Math.cos(angle) * this.spawnRadius,
            0,
            Math.sin(angle) * this.spawnRadius
        );

        const enemy = new Enemy(this.scene, spawnPos, this.base.position);
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
    update(deltaTime) {
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
        }

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

        // Reset base
        this.base.health = this.base.maxHealth;

        console.log('Game logic reset');
    }
}
