/**
 * game.js - Main Game Controller
 * Coordinates all game systems and handles the main game loop.
 *
 * Locomotion and weapons are provided by the ZombieBlaster port: the
 * FPSController (jump/dash/sprint/ADS/bob + player health) and the WeaponSystem
 * (4-weapon arsenal with projectiles, switching, reload, evolution) drive the
 * player, while the existing GameLogic keeps the wave/enemy/base simulation.
 */

class Game {
    constructor() {
        // Core systems
        this.sceneManager = null;
        this.uiManager = null;
        this.gameLogic = null;

        // Game objects
        this.base = null;
        this.enemyTower = null;

        // Ported player + weapon systems
        this.controller = null;
        this.weapons = null;

        // Tower-defense layer (turrets, coins, iso build view)
        this.turretSystem = null;
        this.coinSystem = null;
        this.buildController = null;
        this.economy = { coins: 0 };
        this.viewMode = 'fps'; // 'fps' | 'iso'

        // Player spawn (overwritten from levelData in initialize()).
        this.playerHeight = 1.7;
        this.arenaHalfSize = 18;
        this.playerSpawn = new THREE.Vector3(0, this.playerHeight, 9);

        // Game state
        this.gameState = 'loading';
        this.isPaused = false;

        // Animation
        this.clock = new THREE.Clock();
        this.lastFrameTime = 0;

        // Wave tracking
        this.lastWaveNumber = 0;

        // Reusable scratch vector for knockback math (avoids per-hit allocs).
        this._scratchDir = new THREE.Vector3();
    }

    async initialize() {
        console.log('Initializing game...');

        try {
            this.uiManager = new UIManager();
            this.uiManager.updateLoadingProgress(8, 'Loading UI...');

            this.uiManager.updateLoadingProgress(12, 'Loading level data...');
            this.levelData = await LevelLoader.load();

            const ps = this.levelData.playerSpawn;
            this.playerSpawn.set(ps.x, ps.y, ps.z);
            this.playerHeight = ps.y;
            const arenaSize = this.levelData.arena?.size ?? 40;
            this.arenaHalfSize = arenaSize / 2 - 1;

            // Scene
            this.sceneManager = new SceneManager(this.levelData);
            this.sceneManager.initialize();
            this.uiManager.updateLoadingProgress(20, 'Creating world...');

            // Build the collision world shared by the controller + projectiles.
            const b = this.levelData.base;
            const et = this.levelData.enemyTower;
            this.world = {
                arenaHalfSize: this.arenaHalfSize,
                eyeHeight: this.playerHeight,
                groundY: 0,
                wallHeight: this.levelData.arena?.wallHeight ?? 7,
                towers: [
                    { x: b.x ?? 0, z: b.z ?? 0, radius: b.radius ?? 1.8, height: b.height ?? 4.5 },
                    { x: et.x ?? 0, z: et.z ?? -34, radius: et.radius ?? 5, height: et.height ?? 17 },
                ],
            };
            this.uiManager.updateLoadingProgress(30, 'Initializing defense systems...');

            // Preload player tower, enemy castle, and Skibidi models before spawning.
            await new Promise((resolve) => {
                this.uiManager.updateLoadingProgress(32, 'Loading defense tower...');
                DefenseBase.preload(() => {
                    this.uiManager.updateLoadingProgress(33, 'Loading enemy castle...');
                    EnemyTower.preload(() => {
                        this.uiManager.updateLoadingProgress(34, 'Loading enemy models...');
                        Enemy.preload(resolve);
                    });
                });
            });

            // Defense tower (objective) + enemy spire (spawn source)
            this.base = new DefenseBase(this.sceneManager, this.levelData.base);
            this.enemyTower = new EnemyTower(this.sceneManager, this.levelData.enemyTower);

            // Sync collision radius when the castle GLB scales proportionally from height.
            const etEntry = this.world.towers[1];
            if (etEntry) etEntry.radius = this.enemyTower.radius;

            // Preload the (Draco-compressed) weapon GLBs. Heavy (~54 MB) but
            // best-effort — failures fall back to procedural placeholder guns.
            await ZBAssets.preload(({ done, total }) => {
                const pct = 40 + (total ? (done / total) : 1) * 35;
                this.uiManager.updateLoadingProgress(pct, `Loading arsenal... (${done}/${total})`);
            });
            this.uiManager.updateLoadingProgress(78, 'Arming the player...');

            // First-person controller (owns movement/look/fire/aim/dash input).
            this.controller = new FPSController(this.sceneManager, this.world);
            this.controller.init();
            this.controller.setInputEnabled(false);

            // Weapon arsenal (attaches FP meshes to the controller's weapon holder).
            this.weapons = new WeaponSystem(this.sceneManager, this.controller, this.world);
            this.weapons.init();
            this.uiManager.updateLoadingProgress(88, 'Spooling effects...');

            // Pooled visual effects (particles, explosions, screen shake, etc.)
            ZBEffects.init(this.sceneManager.getScene());

            // Wave/enemy/base simulation
            this.gameLogic = new GameLogic(this.sceneManager, this.base, this.levelData);
            this.uiManager.updateLoadingProgress(94, 'Preparing battle systems...');

            // Tower-defense layer: auto-turrets, coin drops, iso build view.
            this.turretSystem = new TurretSystem(this.sceneManager);
            this.coinSystem = new CoinSystem(this.sceneManager);
            this.buildController = new BuildController(
                this.sceneManager, this.world, this.turretSystem, this.economy, this.base);
            // Each Skibidi death drops a coin at its position (collected on foot).
            this.gameLogic.onEnemyKilled = (enemy) =>
                this.coinSystem.spawn(enemy.position, TD_CONFIG.coinsPerKill);

            // Shell-level input (pause, pointer lock, weapon switch)
            this.setupInputHandlers();

            this.uiManager.initialize({
                onStartGame: () => this.startGame(),
                onResume: () => this.resumeGame(),
                onRestart: () => this.restartGame(),
                onRetry: () => this.restartGame(),
                onPlayAgain: () => this.restartGame(),
            });

            this.uiManager.updateLoadingProgress(100, 'Ready!');

            setTimeout(() => {
                this.gameState = 'menu';
                this.uiManager.showMenu();
            }, 500);

            console.log('Game initialized successfully!');
        } catch (error) {
            console.error('Failed to initialize game:', error);
            if (this.uiManager) this.uiManager.updateLoadingProgress(0, 'Error: ' + error.message);
        }
    }

    setupInputHandlers() {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));

        // Click the canvas to (re)lock the pointer during play — FPS view only
        // (iso build view keeps the cursor free for placing turrets).
        const canvas = this.sceneManager.canvas;
        if (canvas) {
            canvas.addEventListener('click', () => {
                if (this.gameState === 'playing' && !this.isPaused && this.viewMode === 'fps') {
                    this.requestPointerLock();
                }
            });
        }

        // Tab toggles between FPS combat and the top-down build/overwatch view.
        document.addEventListener('keydown', (e) => {
            if (e.code !== 'Tab') return;
            e.preventDefault();
            if (this.gameState !== 'playing' || this.isPaused) return;
            this.toggleView();
        });

        // Weapon switching: number keys 1-4 + scroll wheel.
        document.addEventListener('keydown', (e) => {
            if (this.gameState !== 'playing' || this.isPaused) return;
            const num = parseInt(e.key, 10);
            if (num >= 1 && num <= 4) this.weapons.switchWeapon(num - 1);
        });
        document.addEventListener('wheel', (e) => {
            if (this.gameState !== 'playing' || this.isPaused || !this.weapons) return;
            // In build/overwatch view the wheel zooms the camera (handled by
            // BuildController), so don't also cycle weapons.
            if (this.viewMode !== 'fps') return;
            const dir = e.deltaY > 0 ? 1 : -1;
            const n = this.weapons.WEAPON_DEFS.length;
            const next = (this.weapons.weaponState.currentIndex + dir + n) % n;
            this.weapons.switchWeapon(next);
        });

        document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    }

    startGame() {
        this.gameState = 'playing';
        this.isPaused = false;

        // Always begin in FPS view; clear any leftover build state.
        if (this.viewMode === 'iso') this.buildController.exit();
        this.sceneManager.setBuildViewMode(false);
        for (const e of this.gameLogic.enemies) {
            e.setOverwatchVisible(false);
        }
        this.viewMode = 'fps';
        this.controller.weaponGroup.visible = true;

        this.controller.reset(this.playerSpawn);
        this.weapons.reset();
        ZBEffects.reset();
        this.gameLogic.reset();

        // Reset tower-defense state.
        this.turretSystem.reset();
        this.coinSystem.reset();
        this.economy.coins = 0;
        this.buildController.setWave(0);

        this.controller.setInputEnabled(true);

        this.uiManager.showHUD();
        this.uiManager.setBuildPanelVisible(false);
        this.requestPointerLock();

        this.clock.start();
        this.lastFrameTime = this.clock.getElapsedTime();

        console.log('Game started!');
    }

    /** Switch between FPS combat and the top-down build/overwatch view. */
    toggleView() {
        if (this.viewMode === 'fps') this.enterIsoView();
        else this.enterFpsView();
    }

    enterIsoView() {
        this.viewMode = 'iso';
        // Stop FPS steering/firing and free the cursor for placement.
        this.controller.setInputEnabled(false);
        this.controller.weaponGroup.visible = false;
        this.exitPointerLock();
        this.sceneManager.setBuildViewMode(true);
        for (const e of this.gameLogic.enemies) {
            if (e.isAlive) e.setOverwatchVisible(true);
        }
        this.buildController.setWave(this.gameLogic.currentWave);
        this.buildController.enter();
        this.uiManager.setBuildPanelVisible(true);
    }

    enterFpsView() {
        this.viewMode = 'fps';
        this.sceneManager.setBuildViewMode(false);
        for (const e of this.gameLogic.enemies) {
            e.setOverwatchVisible(false);
        }
        this.buildController.exit();
        this.controller.weaponGroup.visible = true;
        this.controller.setInputEnabled(true);
        this.uiManager.setBuildPanelVisible(false);
        this.requestPointerLock();
    }

    update() {
        requestAnimationFrame(() => this.update());

        const currentTime = this.clock.getElapsedTime();
        const deltaTime = Math.min(currentTime - this.lastFrameTime, 0.1);
        this.lastFrameTime = currentTime;

        if (this.gameState === 'playing' && !this.isPaused) {
            this.updateGameplay(deltaTime);
        }

        // Storm dressing (rain/lightning/torches) keeps animating in every state.
        const camera = this.sceneManager.getCamera();
        this.sceneManager.updateEnvironment(deltaTime, camera.position);

        // Render with screen-shake offset applied around the draw, then restored.
        const shake = (typeof ZBEffects !== 'undefined') ? ZBEffects.getScreenShakeOffset() : null;
        if (shake) camera.position.add(shake);
        this.sceneManager.render();
        if (shake) camera.position.sub(shake);
    }

    updateGameplay(deltaTime) {
        const enemies = this.gameLogic.enemies;
        const isFps = this.viewMode === 'fps';

        // 1. Player / camera. FPS: steer the player. Iso: drive the build view.
        if (isFps) {
            this.controller.update(deltaTime, enemies);
        } else {
            this.buildController.setWave(this.gameLogic.currentWave);
            this.buildController.update(deltaTime);
        }

        // 2. Weapons — projectiles always tick; firing only happens in FPS
        //    (controller input is disabled in iso, so keys.fire stays false).
        this.weapons.update(deltaTime, enemies, (enemy, hitPoint, damage, weaponIndex, hitCtx) =>
            this.onWeaponHit(enemy, hitPoint, damage, weaponIndex, hitCtx));

        // 3. Wave/enemy/base sim. In iso the player is in overwatch and out of
        //    reach, so we omit the player-attack context.
        this.gameLogic.update(deltaTime, isFps ? {
            playerPosition: this.controller.getPosition(),
            onPlayerAttacked: (dmg) => this.controller.damage(dmg),
        } : {});

        // Show enemy overwatch markers for newly spawned Skibidi in build view.
        if (!isFps) {
            for (const e of enemies) {
                if (e.isAlive) e.setOverwatchVisible(true);
            }
        }

        // 3b. Turrets auto-fire in both views; coins can only be vacuumed on
        //     foot (FPS), forcing you back into the field to fund towers.
        this.turretSystem.update(deltaTime, enemies);
        this.coinSystem.update(deltaTime, this.controller.getPosition(), isFps, this.economy);

        // 4. Weapon evolution tracks the kill score
        this.weapons.updateEvolution(this.gameLogic.score);

        // 5. Effects + screen shake
        ZBEffects.update(deltaTime);
        ZBEffects.updateScreenShake(deltaTime);

        // 6. Tower meshes — portal pulse + core light
        if (this.base) this.base.update(deltaTime);
        if (this.enemyTower) this.enemyTower.update(deltaTime);

        // 7. HUD
        const stats = this.gameLogic.getStats();
        const wstats = this.weapons.getStats();
        this.uiManager.updateHUD({
            ...stats,
            playerHealth: this.controller.health,
            playerMaxHealth: this.controller.maxHealth,
            weaponName: wstats.weaponName,
            weaponIndex: wstats.weaponIndex,
            ammo: wstats.ammo,
            dashReady: this.controller.dashCooldownRatio <= 0,
            coins: this.economy.coins,
            viewMode: this.viewMode,
            build: this.buildController.status(),
        });

        if (stats.wave > this.lastWaveNumber) {
            this.uiManager.showWaveStart(stats.wave);
            this.lastWaveNumber = stats.wave;
        }

        // 8. Win / lose
        if (this.gameLogic.hasWon()) {
            this.endGame(true);
        } else if (this.gameLogic.hasLost() || !this.controller.isAlive) {
            this.endGame(false);
        }
    }

    onWeaponHit(enemy, hitPoint, damage, weaponIndex, hitContext = {}) {
        const weapon = this.weapons.WEAPON_DEFS[weaponIndex];
        const fx = weapon.fx || {};
        const hitColor = weapon.projectileColor || weapon.color;

        // Knockback direction: away from player, or radial for splash hits.
        this._scratchDir.copy(this.controller.getForward()).setY(0);
        if (hitContext.fromSplash && hitContext.splashCenter) {
            this._scratchDir.copy(enemy.position).sub(hitContext.splashCenter).setY(0);
        }
        if (this._scratchDir.lengthSq() < 0.0001) this._scratchDir.set(0, 0, 1);
        this._scratchDir.normalize();

        const knockbackStrength = hitContext.fromSplash ? (fx.knockback || 0) * 0.6 : (fx.knockback || 0);
        enemy.applyKnockback(this._scratchDir, knockbackStrength);
        if (fx.status) enemy.applyStatus(fx.status.type, fx.status.duration, fx.status.dps);
        enemy.lastWeaponIndex = weaponIndex;

        const wasAlive = enemy.isAlive;
        enemy.takeDamage(damage);
        const killed = wasAlive && !enemy.isAlive;

        // Hit feedback
        this.uiManager.showHitMarker();

        const particleCount = fx.hitParticles ?? 6;
        if (particleCount > 0) {
            ZBEffects.spawnHitParticles(hitPoint, hitColor, killed ? particleCount + 6 : particleCount);
        }

        if (!hitContext.fromSplash || killed) {
            const headPos = enemy.position.clone().setY(2.0);
            const isCrit = damage >= enemy.maxHealth * 0.5;
            ZBEffects.spawnDamageNumber(headPos, damage, isCrit);
        }

        const shake = killed ? (fx.killShake || fx.shake) : fx.shake;
        if (shake && !hitContext.fromSplash) {
            ZBEffects.triggerScreenShake(shake.amp, shake.duration);
        }

        if (killed) {
            ZBEffects.spawnDeathSplat(hitPoint);
            ZBEffects.spawnPopup(enemy.position.clone().setY(2.0), true);
        }

        // Primary-impact splash effects (skip for AoE victims to avoid stacking).
        if (!hitContext.fromSplash) {
            if (fx.splash === 'explosion') {
                ZBEffects.spawnExplosion(hitPoint, fx.explosionRadius || weapon.aoeRadius || 3.0, hitColor);
            } else if (fx.splash === 'liquid') {
                ZBEffects.spawnLiquidSplash(hitPoint, hitColor, fx.splashCount || 8);
                if (fx.acidPoolChance && Math.random() < fx.acidPoolChance) {
                    ZBEffects.spawnAcidPool(hitPoint, fx.acidPoolRadius || 1.2, fx.acidPoolDuration || 2.0, hitColor, fx.acidPoolDps || 5);
                }
            }
        }
    }

    // Drop out of the iso build view back to a clean FPS state (no pointer
    // lock). Used by pause / game-over so menu clicks can't place turrets.
    _leaveBuildView() {
        if (this.viewMode !== 'iso') return;
        this.buildController.exit();
        this.sceneManager.setBuildViewMode(false);
        for (const e of this.gameLogic.enemies) {
            e.setOverwatchVisible(false);
        }
        this.viewMode = 'fps';
        this.controller.weaponGroup.visible = true;
        this.uiManager.setBuildPanelVisible(false);
    }

    endGame(victory) {
        this.gameState = victory ? 'victory' : 'gameover';
        this._leaveBuildView();
        this.controller.setInputEnabled(false);
        this.exitPointerLock();

        const stats = this.gameLogic.getStats();
        if (victory) {
            this.uiManager.showVictory(stats);
        } else {
            // Tailor the defeat message to what actually killed the run.
            const msgEl = document.getElementById('gameover-message');
            if (msgEl) {
                msgEl.textContent = !this.controller.isAlive
                    ? 'You were overrun by the Skibidi horde!'
                    : 'The tower has been destroyed!';
            }
            this.uiManager.showGameOver(stats);
        }

        console.log(victory ? 'Victory!' : 'Game Over');
    }

    restartGame() {
        this.lastWaveNumber = 0;
        this.startGame();
    }

    pauseGame() {
        if (this.gameState !== 'playing') return;
        this.isPaused = true;
        // Snap back to FPS so the build view can't be driven while paused.
        this._leaveBuildView();
        this.controller.setInputEnabled(false);
        this.exitPointerLock();
        this.uiManager.showPause();
    }

    resumeGame() {
        if (this.gameState !== 'playing') return;
        this.isPaused = false;
        this.controller.setInputEnabled(true);
        this.uiManager.hidePause();
        this.requestPointerLock(); // always FPS after pause
    }

    requestPointerLock() {
        const canvas = this.sceneManager.canvas;
        canvas.requestPointerLock = canvas.requestPointerLock ||
            canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock;
        if (canvas.requestPointerLock) {
            try { canvas.requestPointerLock(); } catch (e) { /* needs user gesture */ }
        }
    }

    exitPointerLock() {
        document.exitPointerLock = document.exitPointerLock ||
            document.mozExitPointerLock || document.webkitExitPointerLock;
        if (document.exitPointerLock) document.exitPointerLock();
    }

    onKeyDown(event) {
        if (event.key === 'Escape' && this.gameState === 'playing') {
            if (this.isPaused) this.resumeGame();
            else this.pauseGame();
        }
    }

    onPointerLockChange() {
        const locked = document.pointerLockElement === this.sceneManager.canvas;
        // Pausing the game pops the pointer lock; that's expected. Nothing else
        // to do — the controller tracks lock state for mouse-look itself.
        console.log('Pointer lock:', locked);
    }
}

// Initialize and start the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, creating game...');
    const game = new Game();
    window.game = game; // exposed for debugging / automated checks
    game.initialize().then(() => game.update());
});
