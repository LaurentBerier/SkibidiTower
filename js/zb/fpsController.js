/**
 * fpsController.js - First-person controller ported from ZombieBlaster (player.js)
 *
 * WASD + mouse-look, jump (gravity), dash (Q, cooldown), sprint-forward (Shift),
 * ADS zoom (right mouse), weapon bob, and player health/damage. Adapted to
 * Skibidi Tower's square arena + cylindrical tower obstacles instead of the
 * ZombieBlaster AABB wall list.
 *
 * The controller owns movement/look/fire/aim/reload/dash input. The Game shell
 * still owns ESC-pause, pointer-lock requests, and weapon-switch keys. The
 * weapon system reads `controller.keys` and `controller.weaponGroup`.
 */
class FPSController {
    constructor(sceneManager, world) {
        this.sceneManager = sceneManager;
        this.camera = sceneManager.getCamera();
        this.world = world; // { arenaHalfSize, eyeHeight, groundY, towers:[{x,z,radius}] }

        this.eyeHeight = world.eyeHeight ?? 1.7;

        this.state = {
            position: new THREE.Vector3(0, this.eyeHeight, 5),
            velocity: new THREE.Vector3(0, 0, 0),
            onGround: true,
            health: 100,
            maxHealth: 100,
            walkSpeed: 6,
            fwdSpeedMultiplier: 1.3,
            runSpeedMultiplier: 1.8,
            jumpForce: 7,
            gravity: -18,
            dashSpeed: 25,
            dashDuration: 0.15,
            dashCooldown: 1.5,
            dashTimer: 0,
            dashCooldownTimer: 0,
            isDashing: false,
            dashDirection: new THREE.Vector3(),
            yaw: 0,
            pitch: 0,
            rotSpeed: 1.0,
            mouseSensitivity: 0.002,
            minPitch: -1.0,
            maxPitch: 1.0,
            isAlive: true,
            invulnTimer: 0,
            playerAttackCooldown: 0,
            bobTime: 0,
            bobIntensity: 0,
        };

        this.keys = {
            forward: false, backward: false, left: false, right: false,
            jump: false, sprint: false, dash: false,
            fire: false, aim: false, reload: false,
        };

        this.pointerLocked = false;
        this.inputEnabled = false; // only steer/fire while actively playing
        this.weaponGroup = null;

        this.WEAPON_VIEW_OFFSET = { x: 0.28, y: -0.35, z: -0.42 };
        this.WEAPON_VIEW_ROTATION = { x: 0.2, y: 0.14, z: -0.0 };
        this.ADS_VIEW_OFFSET = { x: 0.0, y: -0.3, z: -0.34 };
        this.ADS_VIEW_ROTATION = { x: -0.02, y: 0.0, z: 0.0 };
        this.DEFAULT_FOV = 75;
        this.ADS_FOV = 62;
    }

    init() {
        this.camera.position.copy(this.state.position);

        // First-person weapon holder parented to the camera.
        this.weaponGroup = new THREE.Group();
        this.weaponGroup.name = 'fps_weapon_holder';
        this.weaponGroup.position.set(this.WEAPON_VIEW_OFFSET.x, this.WEAPON_VIEW_OFFSET.y, this.WEAPON_VIEW_OFFSET.z);
        this.weaponGroup.rotation.set(this.WEAPON_VIEW_ROTATION.x, this.WEAPON_VIEW_ROTATION.y, this.WEAPON_VIEW_ROTATION.z);
        this.camera.add(this.weaponGroup);
        // Ensure the camera (and its weapon child) are part of the scene graph so
        // the first-person weapon renders.
        this.sceneManager.addToScene(this.camera);

        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mousedown', (e) => this.onMouseDown(e));
        document.addEventListener('mouseup', (e) => this.onMouseUp(e));
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === this.sceneManager.canvas;
        });
    }

    setInputEnabled(enabled) {
        this.inputEnabled = enabled;
        if (!enabled) {
            // Clear held inputs so the player doesn't keep moving/firing while paused.
            for (const k in this.keys) this.keys[k] = false;
        }
    }

    onKeyDown(e) {
        if (!this.inputEnabled) return;
        switch (e.code) {
            case 'KeyW': this.keys.forward = true; break;
            case 'KeyS': this.keys.backward = true; break;
            case 'KeyA': this.keys.left = true; break;
            case 'KeyD': this.keys.right = true; break;
            case 'Space': this.keys.jump = true; break;
            case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = true; break;
            case 'KeyQ': this.keys.dash = true; break;
            case 'KeyR': this.keys.reload = true; break;
        }
    }

    onKeyUp(e) {
        switch (e.code) {
            case 'KeyW': this.keys.forward = false; break;
            case 'KeyS': this.keys.backward = false; break;
            case 'KeyA': this.keys.left = false; break;
            case 'KeyD': this.keys.right = false; break;
            case 'Space': this.keys.jump = false; break;
            case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = false; break;
            case 'KeyQ': this.keys.dash = false; break;
            case 'KeyR': this.keys.reload = false; break;
        }
    }

    onMouseMove(e) {
        if (!this.pointerLocked || !this.inputEnabled) return;
        const s = this.state;
        s.yaw -= e.movementX * s.mouseSensitivity * s.rotSpeed;
        s.pitch -= e.movementY * s.mouseSensitivity * s.rotSpeed;
        s.pitch = Math.max(s.minPitch, Math.min(s.maxPitch, s.pitch));
    }

    onMouseDown(e) {
        if (!this.inputEnabled) return;
        if (e.button === 0) this.keys.fire = true;
        if (e.button === 2) this.keys.aim = true;
    }

    onMouseUp(e) {
        if (e.button === 0) this.keys.fire = false;
        if (e.button === 2) this.keys.aim = false;
    }

    update(dt, enemies) {
        const s = this.state;
        if (!s.isAlive) return this.keys;

        dt = Math.min(dt, 0.05);

        // Camera rotation
        const euler = new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(euler);

        // ADS zoom transition
        const targetFov = this.keys.aim ? this.ADS_FOV : this.DEFAULT_FOV;
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
        this.camera.updateProjectionMatrix();

        // Movement basis (yaw only)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0))
        );
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.yaw, 0))
        );

        if (s.isDashing) {
            s.dashTimer -= dt;
            if (s.dashTimer <= 0) {
                s.isDashing = false;
            } else {
                s.velocity.x = s.dashDirection.x * s.dashSpeed;
                s.velocity.z = s.dashDirection.z * s.dashSpeed;
            }
        } else {
            const moveDir = new THREE.Vector3(0, 0, 0);
            if (this.keys.forward) moveDir.add(forward);
            if (this.keys.backward) moveDir.sub(forward);
            if (this.keys.right) moveDir.add(right);
            if (this.keys.left) moveDir.sub(right);

            if (moveDir.lengthSq() > 0) {
                let actualSpeed = s.walkSpeed;
                const onlyForward = this.keys.forward && !this.keys.backward && !this.keys.left && !this.keys.right;
                if (!this.keys.reload && onlyForward) {
                    actualSpeed *= this.keys.sprint ? s.runSpeedMultiplier : s.fwdSpeedMultiplier;
                }
                moveDir.normalize();
                s.velocity.x = moveDir.x * actualSpeed;
                s.velocity.z = moveDir.z * actualSpeed;
                s.bobIntensity = 1;
            } else {
                s.velocity.x *= 0.85;
                s.velocity.z *= 0.85;
                s.bobIntensity *= 0.9;
            }

            if (this.keys.dash && s.dashCooldownTimer <= 0) {
                s.isDashing = true;
                s.dashTimer = s.dashDuration;
                s.dashCooldownTimer = s.dashCooldown;
                if (moveDir.lengthSq() > 0) s.dashDirection.copy(moveDir.normalize());
                else s.dashDirection.copy(forward);
            }
        }

        if (s.dashCooldownTimer > 0) s.dashCooldownTimer -= dt;

        // Jump
        if (this.keys.jump && s.onGround) {
            s.velocity.y = s.jumpForce;
            s.onGround = false;
        }
        if (!s.onGround) s.velocity.y += s.gravity * dt;

        if (s.invulnTimer > 0) s.invulnTimer -= dt;
        if (s.playerAttackCooldown > 0) s.playerAttackCooldown -= dt;

        // Integrate
        const newPos = s.position.clone();
        newPos.x += s.velocity.x * dt;
        newPos.z += s.velocity.z * dt;
        newPos.y += s.velocity.y * dt;

        const playerRadius = 0.4;

        // Arena bounds
        const limit = this.world.arenaHalfSize;
        if (newPos.x > limit) { newPos.x = limit; s.velocity.x = 0; }
        else if (newPos.x < -limit) { newPos.x = -limit; s.velocity.x = 0; }
        if (newPos.z > limit) { newPos.z = limit; s.velocity.z = 0; }
        else if (newPos.z < -limit) { newPos.z = -limit; s.velocity.z = 0; }

        // Cylindrical tower obstacles (defense tower + enemy spire)
        if (Array.isArray(this.world.towers)) {
            for (const t of this.world.towers) {
                const dx = newPos.x - t.x;
                const dz = newPos.z - t.z;
                const combined = (t.radius ?? 1) + playerRadius;
                const distSq = dx * dx + dz * dz;
                if (distSq < combined * combined && distSq > 0.0001) {
                    const dist = Math.sqrt(distSq);
                    const push = combined - dist;
                    newPos.x += (dx / dist) * push;
                    newPos.z += (dz / dist) * push;
                }
            }
        }

        // Enemy collision push (player slides, enemy stays put)
        if (Array.isArray(enemies)) {
            for (let i = 0; i < enemies.length; i++) {
                const enemy = enemies[i];
                if (!enemy || !enemy.isAlive) continue;
                const dx = newPos.x - enemy.position.x;
                const dz = newPos.z - enemy.position.z;
                const distSq = dx * dx + dz * dz;
                const combined = playerRadius + (enemy.hitRadius ?? 0.7);
                if (distSq < combined * combined && distSq > 0.0001) {
                    const dist = Math.sqrt(distSq);
                    const overlap = combined - dist;
                    newPos.x += (dx / dist) * overlap;
                    newPos.z += (dz / dist) * overlap;
                }
            }
        }

        // Ground collision — follow the rolling terrain height. The eye sits
        // `eyeHeight` above the ground at the player's x/z. On gentle downslopes
        // we "glue" to the surface (within a small step) so walking downhill
        // doesn't make the camera float then drop.
        const terrainY = this.sceneManager.getGroundHeight
            ? this.sceneManager.getGroundHeight(newPos.x, newPos.z) : 0;
        const groundLevel = terrainY + this.eyeHeight;
        const wasOnGround = s.onGround;
        if (newPos.y <= groundLevel || (wasOnGround && newPos.y - groundLevel < 1.5)) {
            newPos.y = groundLevel;
            s.velocity.y = 0;
            s.onGround = true;
        } else {
            s.onGround = false;
        }

        s.position.copy(newPos);
        this.camera.position.copy(s.position);

        this.updateWeaponBob(dt);
        return this.keys;
    }

    updateWeaponBob(dt) {
        const s = this.state;
        const activeOffset = this.keys.aim ? this.ADS_VIEW_OFFSET : this.WEAPON_VIEW_OFFSET;
        const activeRotation = this.keys.aim ? this.ADS_VIEW_ROTATION : this.WEAPON_VIEW_ROTATION;
        const bobScale = this.keys.aim ? 0.35 : 1.0;
        if (!this.weaponGroup) return;
        if (s.bobIntensity > 0.01) {
            s.bobTime += dt * 10;
            const bobX = Math.sin(s.bobTime) * 0.03 * s.bobIntensity * bobScale;
            const bobY = Math.abs(Math.cos(s.bobTime)) * 0.04 * s.bobIntensity * bobScale;
            this.weaponGroup.position.set(activeOffset.x + bobX, activeOffset.y + bobY, activeOffset.z);
            this.weaponGroup.rotation.set(activeRotation.x, activeRotation.y, activeRotation.z);
        } else {
            this.weaponGroup.position.set(activeOffset.x, activeOffset.y, activeOffset.z);
            this.weaponGroup.rotation.set(activeRotation.x, activeRotation.y, activeRotation.z);
        }
    }

    // Returns true if the hit actually landed (player alive + not invulnerable).
    damage(amount) {
        const s = this.state;
        if (s.invulnTimer > 0 || !s.isAlive) return false;
        s.health -= amount;
        s.invulnTimer = 0.3;
        const overlay = document.getElementById('damage-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            clearTimeout(overlay._t);
            overlay._t = setTimeout(() => overlay.classList.add('hidden'), 300);
        }
        if (s.health <= 0) {
            s.health = 0;
            s.isAlive = false;
        }
        return true;
    }

    // Player attacks happen on a shared cooldown so a swarm doesn't melt you instantly.
    canBeAttacked() {
        return this.state.playerAttackCooldown <= 0 && this.state.isAlive;
    }
    registerAttack() {
        this.state.playerAttackCooldown = 0.6;
    }

    reset(spawn) {
        const s = this.state;
        s.position.set(spawn.x, spawn.y ?? this.eyeHeight, spawn.z);
        s.velocity.set(0, 0, 0);
        s.health = s.maxHealth;
        s.isAlive = true;
        s.onGround = true;
        s.yaw = 0;
        s.pitch = 0;
        s.dashCooldownTimer = 0;
        s.isDashing = false;
        s.invulnTimer = 0;
        s.playerAttackCooldown = 0;
        s.bobIntensity = 0;
        this.keys.sprint = false;
        this.keys.dash = false;
        this.keys.aim = false;
        this.keys.fire = false;
        this.keys.reload = false;
        this.camera.fov = this.DEFAULT_FOV;
        this.camera.updateProjectionMatrix();
        this.camera.position.copy(s.position);
    }

    getForward() {
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(this.camera.quaternion);
        return dir;
    }

    getPosition() {
        return this.state.position.clone();
    }

    get health() { return this.state.health; }
    get maxHealth() { return this.state.maxHealth; }
    get isAlive() { return this.state.isAlive; }
    get dashCooldownRatio() {
        return Math.max(0, this.state.dashCooldownTimer) / this.state.dashCooldown;
    }
}

window.FPSController = FPSController;
