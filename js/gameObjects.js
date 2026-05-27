/**
 * gameObjects.js - Game Entity Classes
 * Defines Base, Enemy, Weapon, and Projectile classes
 */

/**
 * DefenseBase - The central objective to defend
 */
class DefenseBase {
    constructor(scene) {
        this.scene = scene;
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.mesh = null;
        this.position = new THREE.Vector3(0, 0, 0);

        this.createMesh();
    }

    createMesh() {
        const group = new THREE.Group();

        // Main tower body
        const bodyGeometry = new THREE.CylinderGeometry(2, 2.5, 6, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x707070,
            roughness: 0.8,
            metalness: 0.2,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 3;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Top accent
        const topGeometry = new THREE.CylinderGeometry(2.2, 2.2, 0.5, 8);
        const topMaterial = new THREE.MeshStandardMaterial({
            color: 0xFF4500,
            roughness: 0.3,
            metalness: 0.5,
            emissive: 0xFF4500,
            emissiveIntensity: 0.3,
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

        // Add pulsing light
        const coreLight = new THREE.PointLight(0xFFD700, 1, 15);
        coreLight.position.y = 4;
        group.add(coreLight);

        this.mesh = group;
        this.mesh.position.copy(this.position);
        this.coreLight = coreLight;

        this.scene.addToScene(this.mesh);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);

        // Visual feedback - flash red
        const body = this.mesh.children[0];
        const originalColor = body.material.color.getHex();
        body.material.color.setHex(0xFF0000);

        setTimeout(() => {
            if (body.material) {
                body.material.color.setHex(originalColor);
            }
        }, 100);

        return this.health;
    }

    update(deltaTime) {
        // Pulse the core light
        if (this.coreLight) {
            this.coreLight.intensity = 1 + Math.sin(Date.now() * 0.003) * 0.3;
        }
    }

    isDestroyed() {
        return this.health <= 0;
    }

    /**
     * Get collision radius for the base
     */
    getCollisionRadius() {
        return 2.5; // Bottom radius of the cylinder
    }

    /**
     * Get the top height of the base
     */
    getTopHeight() {
        return 6.5; // Top of the tower
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
        this.damage = 10;
        this.attackCooldown = 1.0; // seconds
        this.lastAttackTime = 0;
        this.isAlive = true;

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

    update(deltaTime, baseRadius = 2.5) {
        if (!this.isAlive || !this.mesh) return;

        // Move toward target
        const direction = new THREE.Vector3()
            .subVectors(this.target, this.position)
            .normalize();

        this.velocity = direction.multiplyScalar(this.speed);

        // Calculate new position
        const newPosition = this.position.clone().add(this.velocity.clone().multiplyScalar(deltaTime));

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

        // Bobbing animation with raised base height (40% higher than previous)
        this.mesh.position.y = 1.27 + Math.abs(Math.sin(Date.now() * 0.005)) * 0.2;
    }

    takeDamage(amount) {
        this.health -= amount;

        // Flash white on hit (works with GLB models)
        if (this.mesh) {
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

// Static template — populated by Enemy.preload() before any enemies spawn
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
