/**
 * ui.js - User Interface Manager
 * Handles HUD updates, menus, and screen management
 */

class UIManager {
    constructor() {
        // Screen elements
        this.loadingScreen = document.getElementById('loading-screen');
        this.menuScreen = document.getElementById('menu-screen');
        this.hud = document.getElementById('hud');
        this.pauseMenu = document.getElementById('pause-menu');
        this.gameoverScreen = document.getElementById('gameover-screen');
        this.victoryScreen = document.getElementById('victory-screen');

        // HUD elements
        this.baseHealthBar = document.getElementById('base-health-bar');
        this.baseHealthText = document.getElementById('base-health-text');
        this.playerHealthBar = document.getElementById('player-health-bar');
        this.playerHealthText = document.getElementById('player-health-text');
        this.waveNumber = document.getElementById('wave-number');
        this.ammoCount = document.getElementById('ammo-count');
        this.weaponName = document.getElementById('weapon-name');
        this.enemyCount = document.getElementById('enemy-count');

        // Tower-defense HUD
        this.coinCount = document.getElementById('coin-count');
        this.buildPanel = document.getElementById('build-panel');
        this.buildCost = document.getElementById('build-cost');
        this.buildSlots = document.getElementById('build-slots');
        this.buildHint = document.getElementById('build-hint');
        this.viewHint = document.getElementById('view-hint');

        // Buttons
        this.startButton = document.getElementById('start-button');
        this.resumeButton = document.getElementById('resume-button');
        this.restartButton = document.getElementById('restart-button');
        this.retryButton = document.getElementById('retry-button');
        this.playAgainButton = document.getElementById('play-again-button');

        // Loading progress
        this.loadingProgress = document.getElementById('loading-progress');
        this.loadingText = document.getElementById('loading-text');

        this.initialized = false;
    }

    /**
     * Initialize UI and set up event listeners
     */
    initialize(callbacks) {
        this.startButton.addEventListener('click', () => {
            if (callbacks.onStartGame) callbacks.onStartGame();
        });

        this.resumeButton.addEventListener('click', () => {
            if (callbacks.onResume) callbacks.onResume();
        });

        this.restartButton.addEventListener('click', () => {
            if (callbacks.onRestart) callbacks.onRestart();
        });

        this.retryButton.addEventListener('click', () => {
            if (callbacks.onRetry) callbacks.onRetry();
        });

        this.playAgainButton.addEventListener('click', () => {
            if (callbacks.onPlayAgain) callbacks.onPlayAgain();
        });

        this.initialized = true;
        console.log('UI Manager initialized');
    }

    /**
     * Update loading screen progress
     */
    updateLoadingProgress(progress, message) {
        if (this.loadingProgress) {
            this.loadingProgress.style.width = `${progress}%`;
        }
        if (this.loadingText && message) {
            this.loadingText.textContent = message;
        }
    }

    /**
     * Hide loading screen and show menu
     */
    showMenu() {
        this.hideAll();
        this.menuScreen.classList.remove('hidden');
    }

    /**
     * Show game HUD
     */
    showHUD() {
        this.hideAll();
        this.hud.classList.remove('hidden');
    }

    /**
     * Show pause menu
     */
    showPause() {
        this.pauseMenu.classList.remove('hidden');
    }

    /**
     * Hide pause menu
     */
    hidePause() {
        this.pauseMenu.classList.add('hidden');
    }

    /**
     * Show game over screen
     */
    showGameOver(stats) {
        this.hideAll();

        document.getElementById('final-wave').textContent = stats.wave;
        document.getElementById('final-kills').textContent = stats.totalKills;

        this.gameoverScreen.classList.remove('hidden');
    }

    /**
     * Show victory screen
     */
    showVictory(stats) {
        this.hideAll();

        document.getElementById('victory-waves').textContent = stats.wave;
        document.getElementById('victory-kills').textContent = stats.totalKills;

        this.victoryScreen.classList.remove('hidden');
    }

    /**
     * Hide all screens
     */
    hideAll() {
        this.loadingScreen.classList.add('hidden');
        this.menuScreen.classList.add('hidden');
        this.hud.classList.add('hidden');
        this.pauseMenu.classList.add('hidden');
        this.gameoverScreen.classList.add('hidden');
        this.victoryScreen.classList.add('hidden');
    }

    /**
     * Update HUD with game stats
     */
    updateHUD(stats) {
        // Base (tower) health
        const healthPercent = (stats.baseHealth / stats.maxBaseHealth) * 100;
        this.baseHealthBar.style.width = `${healthPercent}%`;
        this.baseHealthText.textContent = Math.ceil(stats.baseHealth);

        // Player health
        if (this.playerHealthBar && stats.playerMaxHealth) {
            const pPct = (stats.playerHealth / stats.playerMaxHealth) * 100;
            this.playerHealthBar.style.width = `${pPct}%`;
            if (this.playerHealthText) this.playerHealthText.textContent = Math.ceil(stats.playerHealth);
        }

        // Weapon name + ammo
        if (this.weaponName && stats.weaponName) this.weaponName.textContent = stats.weaponName;
        if (this.ammoCount && stats.ammo !== undefined) {
            this.ammoCount.textContent = (stats.ammo === Infinity) ? '∞' : stats.ammo;
        }

        // Low health warning — triggers on whichever of tower/player is critical.
        const playerPct = stats.playerMaxHealth ? (stats.playerHealth / stats.playerMaxHealth) * 100 : 100;
        if (healthPercent < 30 || playerPct < 30) {
            document.body.classList.add('low-health');
        } else {
            document.body.classList.remove('low-health');
        }

        // Wave number
        if (stats.wave > 0) {
            this.waveNumber.textContent = `${stats.wave}/${stats.maxWaves}`;
        } else {
            // Show countdown to first wave
            if (stats.timeUntilNextWave > 0) {
                this.waveNumber.textContent = `${Math.ceil(stats.timeUntilNextWave)}`;
            } else {
                this.waveNumber.textContent = 'READY';
            }
        }

        // Enemy count
        this.enemyCount.textContent = stats.enemiesAlive;

        // Coins
        if (this.coinCount && stats.coins !== undefined) {
            this.coinCount.textContent = stats.coins;
        }

        // Build panel (iso view) — affordability + slot usage.
        if (stats.build && this.buildPanel) {
            const b = stats.build;
            if (this.buildCost) this.buildCost.textContent = `${b.cost}`;
            if (this.buildSlots) this.buildSlots.textContent = `${b.used}/${b.allowed}`;
            if (this.buildHint) {
                let msg, color;
                if (b.used >= b.allowed) { msg = `Turret limit reached — survive to wave ${(b.used) * 2 + 1} for another slot`; color = '#ff7a4a'; }
                else if (b.coins < b.cost) { msg = `Need ${b.cost - b.coins} more coins — switch to FPS [TAB] and collect`; color = '#ff7a4a'; }
                else { msg = 'Click a green spot to build a turret'; color = '#8effa6'; }
                this.buildHint.textContent = msg;
                this.buildHint.style.color = color;
            }
        }

        // Persistent control hint reflecting the current view.
        if (this.viewHint) {
            this.viewHint.textContent = stats.viewMode === 'iso'
                ? '[TAB] Return to FPS'
                : '[TAB] Build View';
        }

        // Wave status indicator
        if (!stats.isWaveActive && stats.wave > 0 && stats.wave < stats.maxWaves) {
            if (stats.timeUntilNextWave > 0) {
                this.showWaveMessage(`Wave ${stats.wave + 1} in ${Math.ceil(stats.timeUntilNextWave)}...`);
            }
        }
    }

    /** Show/hide the iso-view turret build panel. */
    setBuildPanelVisible(visible) {
        if (this.buildPanel) this.buildPanel.classList.toggle('hidden', !visible);
    }

    /**
     * Show temporary message on HUD
     */
    showWaveMessage(message, duration = 2000) {
        // Remove existing message
        const existing = document.getElementById('wave-message');
        if (existing) {
            existing.remove();
        }

        // Create message element
        const messageEl = document.createElement('div');
        messageEl.id = 'wave-message';
        messageEl.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 36px;
            color: #FFD700;
            background: rgba(32, 32, 32, 0.9);
            border: 3px solid #FF4500;
            padding: 20px 40px;
            letter-spacing: 3px;
            text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
            z-index: 200;
            animation: pulse 1s infinite;
        `;
        messageEl.textContent = message;

        this.hud.appendChild(messageEl);

        // Remove after duration
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, duration);
    }

    /**
     * Show hit marker
     */
    showHitMarker() {
        const marker = document.createElement('div');
        marker.className = 'hit-marker';
        marker.textContent = 'X';
        marker.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 40px;
            color: #FF4500;
            font-weight: bold;
            pointer-events: none;
            z-index: 200;
            text-shadow: 0 0 10px #FF4500;
        `;

        this.hud.appendChild(marker);

        setTimeout(() => {
            if (marker.parentNode) {
                marker.remove();
            }
        }, 100);
    }

    /**
     * Show damage number at screen position
     */
    showDamageNumber(screenX, screenY, damage) {
        const damageEl = document.createElement('div');
        damageEl.className = 'damage-indicator';
        damageEl.textContent = `-${damage}`;
        damageEl.style.left = `${screenX}px`;
        damageEl.style.top = `${screenY}px`;

        this.hud.appendChild(damageEl);

        setTimeout(() => {
            if (damageEl.parentNode) {
                damageEl.remove();
            }
        }, 1000);
    }

    /**
     * Show wave start message
     */
    showWaveStart(waveNumber) {
        this.showWaveMessage(`WAVE ${waveNumber} - INCOMING!`, 3000);
    }

    /**
     * Show wave complete message
     */
    showWaveComplete(waveNumber) {
        this.showWaveMessage(`WAVE ${waveNumber} COMPLETE!`, 2500);
    }

    /**
     * Get pointer lock status message
     */
    getControlsMessage() {
        return 'Click to start | WASD: Move | Mouse: Look | LMB: Shoot | ESC: Pause';
    }
}
