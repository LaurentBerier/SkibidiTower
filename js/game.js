/**
 * game.js - Main Game Controller
 * Coordinates all game systems and handles the main game loop
 */

class Game {
    constructor() {
        // Core systems
        this.sceneManager = null;
        this.uiManager = null;
        this.gameLogic = null;

        // Game objects
        this.base = null;
        this.weapon = null;

        // Player state - on tower top with movement
        this.towerTopHeight = 8.2; // 6.5 (tower) + 1.7 (eye level)
        this.towerTopRadius = 2.0; // Safe movement radius on tower top
        this.playerPosition = new THREE.Vector3(0, this.towerTopHeight, 0);
        this.playerVelocity = new THREE.Vector3();
        this.playerSpeed = 3; // Reduced speed for tower top
        this.mouseSensitivity = 0.002;
        this.pitch = 0;
        this.yaw = 0;

        // Input state
        this.keys = {};
        this.mouseMovement = { x: 0, y: 0 };
        this.isPointerLocked = false;

        // Game state
        this.gameState = 'loading'; // loading, menu, playing, paused, gameover, victory
        this.isPaused = false;

        // Animation
        this.clock = new THREE.Clock();
        this.lastFrameTime = 0;

        // Wave tracking
        this.lastWaveNumber = 0;
    }

    /**
     * Initialize the game
     */
    async initialize() {
        console.log('Initializing game...');

        try {
            // Initialize UI
            this.uiManager = new UIManager();
            this.uiManager.updateLoadingProgress(20, 'Loading UI...');

            // Initialize scene
            this.sceneManager = new SceneManager();
            this.sceneManager.initialize();
            this.uiManager.updateLoadingProgress(40, 'Creating world...');

            // Create game objects
            this.base = new DefenseBase(this.sceneManager);
            this.uiManager.updateLoadingProgress(55, 'Initializing defense systems...');

            // Preload enemy model before any enemies can spawn (eliminates race condition)
            await new Promise((resolve) => {
                this.uiManager.updateLoadingProgress(60, 'Loading enemy models...');
                Enemy.preload(resolve);
            });
            this.uiManager.updateLoadingProgress(75, 'Enemy models ready...');

            // Create weapon
            this.weapon = new Weapon(this.sceneManager, this.sceneManager.getCamera());
            this.uiManager.updateLoadingProgress(80, 'Loading weapons...');

            // Initialize game logic
            this.gameLogic = new GameLogic(this.sceneManager, this.base);
            this.uiManager.updateLoadingProgress(88, 'Preparing battle systems...');

            // Setup input handlers
            this.setupInputHandlers();
            this.uiManager.updateLoadingProgress(94, 'Configuring controls...');

            // Initialize UI callbacks
            this.uiManager.initialize({
                onStartGame: () => this.startGame(),
                onResume: () => this.resumeGame(),
                onRestart: () => this.restartGame(),
                onRetry: () => this.restartGame(),
                onPlayAgain: () => this.restartGame()
            });

            this.uiManager.updateLoadingProgress(100, 'Ready!');

            // Show menu after brief delay
            setTimeout(() => {
                this.gameState = 'menu';
                this.uiManager.showMenu();
            }, 500);

            console.log('Game initialized successfully!');

        } catch (error) {
            console.error('Failed to initialize game:', error);
            this.uiManager.updateLoadingProgress(0, 'Error: ' + error.message);
        }
    }

    /**
     * Setup input event handlers
     */
    setupInputHandlers() {
        // Keyboard input
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse input
        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('click', (e) => this.onMouseClick(e));

        // Pointer lock
        document.addEventListener('pointerlockchange', () => this.onPointerLockChange());

        // Prevent context menu
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /**
     * Start the game
     */
    startGame() {
        this.gameState = 'playing';
        this.isPaused = false;

        // Position player on top of tower
        this.playerPosition.set(0, this.towerTopHeight, 0);
        this.pitch = 0;
        this.yaw = 0;

        // Update camera
        const camera = this.sceneManager.getCamera();
        camera.position.copy(this.playerPosition);
        camera.rotation.set(0, 0, 0);

        // Show HUD
        this.uiManager.showHUD();

        // Request pointer lock
        this.requestPointerLock();

        // Start game loop
        this.clock.start();
        this.lastFrameTime = this.clock.getElapsedTime();

        // Reset game logic
        this.gameLogic.reset();

        console.log('Game started!');
    }

    /**
     * Main game loop
     */
    update() {
        requestAnimationFrame(() => this.update());

        const currentTime = this.clock.getElapsedTime();
        const deltaTime = Math.min(currentTime - this.lastFrameTime, 0.1); // Cap at 100ms
        this.lastFrameTime = currentTime;

        // Update based on game state
        if (this.gameState === 'playing' && !this.isPaused) {
            this.updateGameplay(deltaTime);
        }

        // Always render
        this.sceneManager.render();
    }

    /**
     * Update gameplay logic
     */
    updateGameplay(deltaTime) {
        // Update player
        this.updatePlayer(deltaTime);

        // Update weapon
        this.weapon.update(deltaTime);

        // Update game logic
        this.gameLogic.update(deltaTime);

        // Update UI
        const stats = this.gameLogic.getStats();
        this.uiManager.updateHUD(stats);

        // Check for wave changes
        if (stats.wave > this.lastWaveNumber) {
            this.uiManager.showWaveStart(stats.wave);
            this.lastWaveNumber = stats.wave;
        }

        // Check win/lose conditions
        if (this.gameLogic.hasWon()) {
            this.endGame(true);
        } else if (this.gameLogic.hasLost()) {
            this.endGame(false);
        }
    }

    /**
     * Update player movement (constrained to tower top)
     */
    updatePlayer(deltaTime) {
        const camera = this.sceneManager.getCamera();

        // Calculate movement direction
        const moveDirection = new THREE.Vector3();

        if (this.keys['w'] || this.keys['W']) moveDirection.z += 1;
        if (this.keys['s'] || this.keys['S']) moveDirection.z -= 1;
        if (this.keys['a'] || this.keys['A']) moveDirection.x -= 1;
        if (this.keys['d'] || this.keys['D']) moveDirection.x += 1;

        // Normalize movement
        if (moveDirection.length() > 0) {
            moveDirection.normalize();

            // Apply camera rotation to movement
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

            forward.y = 0;
            right.y = 0;
            forward.normalize();
            right.normalize();

            this.playerVelocity.x = (forward.x * moveDirection.z + right.x * moveDirection.x) * this.playerSpeed;
            this.playerVelocity.z = (forward.z * moveDirection.z + right.z * moveDirection.x) * this.playerSpeed;
        } else {
            // Deceleration
            this.playerVelocity.x *= 0.8;
            this.playerVelocity.z *= 0.8;
        }

        // Calculate new position
        const newPosition = this.playerPosition.clone();
        newPosition.x += this.playerVelocity.x * deltaTime;
        newPosition.z += this.playerVelocity.z * deltaTime;

        // Keep at tower top height
        newPosition.y = this.towerTopHeight;

        // Constrain to tower top radius (prevent falling off)
        const distanceFromCenter = Math.sqrt(newPosition.x * newPosition.x + newPosition.z * newPosition.z);

        if (distanceFromCenter > this.towerTopRadius) {
            // Player trying to go beyond edge - clamp to radius
            const angle = Math.atan2(newPosition.z, newPosition.x);
            newPosition.x = Math.cos(angle) * this.towerTopRadius;
            newPosition.z = Math.sin(angle) * this.towerTopRadius;

            // Stop velocity when hitting edge
            this.playerVelocity.x = 0;
            this.playerVelocity.z = 0;
        }

        // Update player position
        this.playerPosition.copy(newPosition);

        // Update camera position
        camera.position.copy(this.playerPosition);

        // Update camera rotation from mouse
        this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2, Math.PI / 2);
        camera.rotation.order = 'YXZ';
        camera.rotation.x = this.pitch;
        camera.rotation.y = this.yaw;
    }

    /**
     * Handle shooting
     */
    handleShooting() {
        if (this.gameState !== 'playing' || this.isPaused) return;

        const camera = this.sceneManager.getCamera();
        const hitEnemy = this.gameLogic.shoot(camera, this.weapon);

        if (hitEnemy) {
            this.uiManager.showHitMarker();
        }
    }

    /**
     * End the game
     */
    endGame(victory) {
        this.gameState = victory ? 'victory' : 'gameover';
        this.exitPointerLock();

        const stats = this.gameLogic.getStats();

        if (victory) {
            this.uiManager.showVictory(stats);
        } else {
            this.uiManager.showGameOver(stats);
        }

        console.log(victory ? 'Victory!' : 'Game Over');
    }

    /**
     * Restart the game
     */
    restartGame() {
        this.lastWaveNumber = 0;
        this.startGame();
    }

    /**
     * Pause the game
     */
    pauseGame() {
        if (this.gameState !== 'playing') return;

        this.isPaused = true;
        this.exitPointerLock();
        this.uiManager.showPause();
    }

    /**
     * Resume the game
     */
    resumeGame() {
        if (this.gameState !== 'playing') return;

        this.isPaused = false;
        this.uiManager.hidePause();
        this.requestPointerLock();
    }

    /**
     * Request pointer lock
     */
    requestPointerLock() {
        const canvas = this.sceneManager.canvas;
        canvas.requestPointerLock = canvas.requestPointerLock ||
                                     canvas.mozRequestPointerLock ||
                                     canvas.webkitRequestPointerLock;
        if (canvas.requestPointerLock) {
            canvas.requestPointerLock();
        }
    }

    /**
     * Exit pointer lock
     */
    exitPointerLock() {
        document.exitPointerLock = document.exitPointerLock ||
                                   document.mozExitPointerLock ||
                                   document.webkitExitPointerLock;
        if (document.exitPointerLock) {
            document.exitPointerLock();
        }
    }

    /**
     * Event Handlers
     */

    onKeyDown(event) {
        this.keys[event.key] = true;

        // ESC to pause
        if (event.key === 'Escape' && this.gameState === 'playing') {
            if (this.isPaused) {
                this.resumeGame();
            } else {
                this.pauseGame();
            }
        }
    }

    onKeyUp(event) {
        this.keys[event.key] = false;
    }

    onMouseMove(event) {
        if (!this.isPointerLocked) return;

        const movementX = event.movementX || event.mozMovementX || event.webkitMovementX || 0;
        const movementY = event.movementY || event.mozMovementY || event.webkitMovementY || 0;

        this.yaw -= movementX * this.mouseSensitivity;
        this.pitch -= movementY * this.mouseSensitivity;
    }

    onMouseClick(event) {
        if (this.gameState === 'playing' && !this.isPaused && this.isPointerLocked) {
            this.handleShooting();
        }
    }

    onPointerLockChange() {
        this.isPointerLocked = document.pointerLockElement === this.sceneManager.canvas ||
                              document.mozPointerLockElement === this.sceneManager.canvas ||
                              document.webkitPointerLockElement === this.sceneManager.canvas;

        console.log('Pointer lock:', this.isPointerLocked);
    }
}

// Initialize and start the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, creating game...');

    const game = new Game();
    game.initialize().then(() => {
        // Start the game loop
        game.update();
    });
});
