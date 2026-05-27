/**
 * scene.js - Three.js Scene Setup and Management
 * Handles scene, camera, renderer, and lighting configuration
 */

class SceneManager {
    constructor(levelData = null) {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.canvas = null;

        // Scene objects
        this.arena = null;
        this.lights = [];

        // Level-driven config (falls back to defaults if no level passed)
        const arena = (levelData && levelData.arena) || { size: 40, wallHeight: 5 };
        this.ARENA_SIZE = arena.size;
        this.ARENA_WALL_HEIGHT = arena.wallHeight;
        this.levelLights = (levelData && levelData.lights) || [];
        this.customProps = (levelData && levelData.customProps) || [];
    }

    /**
     * Initialize the Three.js scene
     */
    initialize() {
        // Get canvas
        this.canvas = document.getElementById('game-canvas');

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);
        this.scene.fog = new THREE.Fog(0x202020, 30, 80);

        // Create camera (FPS perspective)
        this.camera = new THREE.PerspectiveCamera(
            75, // FOV
            window.innerWidth / window.innerHeight, // Aspect
            0.1, // Near
            1000 // Far
        );
        this.camera.position.set(0, 1.7, 0); // Eye level height

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Setup lighting
        this.setupLighting();
        this.addLevelLights();

        // Create arena
        this.createArena();

        // Load any custom GLB props placed in the level editor
        this.loadCustomProps();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        console.log('Scene initialized successfully');
    }

    /**
     * Setup game lighting
     */
    setupLighting() {
        // Ambient light for overall illumination
        const ambientLight = new THREE.AmbientLight(0x707070, 0.6);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Main directional light (simulates sun)
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(10, 20, 10);
        mainLight.castShadow = true;
        mainLight.shadow.camera.left = -50;
        mainLight.shadow.camera.right = 50;
        mainLight.shadow.camera.top = 50;
        mainLight.shadow.camera.bottom = -50;
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        this.scene.add(mainLight);
        this.lights.push(mainLight);

        // Accent light from opposite direction
        const accentLight = new THREE.DirectionalLight(0xFF4500, 0.3);
        accentLight.position.set(-10, 15, -10);
        this.scene.add(accentLight);
        this.lights.push(accentLight);

        // Point light at center for dramatic effect
        const centerLight = new THREE.PointLight(0xFFD700, 0.5, 30);
        centerLight.position.set(0, 5, 0);
        this.scene.add(centerLight);
        this.lights.push(centerLight);
    }

    /**
     * Add designer-placed PointLights from levelData.json on top of the
     * default atmospheric lighting.
     */
    addLevelLights() {
        for (const l of this.levelLights) {
            const colorInt = typeof l.color === 'string'
                ? parseInt(l.color.replace(/^0x/i, ''), 16)
                : (l.color ?? 0xffffff);
            const light = new THREE.PointLight(colorInt, l.intensity ?? 1, l.distance ?? 0);
            light.position.set(l.x ?? 0, l.y ?? 0, l.z ?? 0);
            this.scene.add(light);
            this.lights.push(light);
        }
    }

    /**
     * Load designer-placed GLB props from levelData.json. Resolves each
     * asset filename to a URL via /api/asset-kits (kit_folder mapping).
     * Best-effort: a missing asset logs a warning and skips that prop.
     */
    async loadCustomProps() {
        if (!this.customProps || this.customProps.length === 0) return;

        const LoaderCtor = (typeof THREE !== 'undefined' && THREE.GLTFLoader)
            ? THREE.GLTFLoader
            : (typeof GLTFLoader !== 'undefined' ? GLTFLoader : null);
        if (!LoaderCtor) {
            console.warn('GLTFLoader not available — skipping customProps.');
            return;
        }

        let kitMap = {};
        try {
            const resp = await fetch('/api/asset-kits', { cache: 'no-store' });
            if (resp.ok) kitMap = await resp.json();
        } catch (_) { /* fall back to default kit folder */ }

        const loader = new LoaderCtor();
        for (const p of this.customProps) {
            const kit = kitMap[p.asset] ?? 'props';
            const url = `assets/${kit}/${p.asset}`;
            loader.load(url, (gltf) => {
                const node = gltf.scene;
                node.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
                node.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
                if (typeof p.sx === 'number' || typeof p.sy === 'number' || typeof p.sz === 'number') {
                    node.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
                } else {
                    node.scale.setScalar(p.scale ?? 1);
                }
                node.traverse(c => {
                    if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
                });
                this.scene.add(node);
            }, undefined, (err) => {
                console.warn(`Failed to load custom prop ${p.id} (${url}):`, err);
            });
        }
    }

    /**
     * Create the game arena
     */
    createArena() {
        const arenaGroup = new THREE.Group();

        // Floor
        const floorGeometry = new THREE.PlaneGeometry(this.ARENA_SIZE, this.ARENA_SIZE);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x303030,
            roughness: 0.8,
            metalness: 0.2
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        arenaGroup.add(floor);

        // Floor grid pattern
        const gridHelper = new THREE.GridHelper(this.ARENA_SIZE, 20, 0x505050, 0x404040);
        arenaGroup.add(gridHelper);

        // Create walls (4 sides)
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0x404040,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true
        });

        // North wall
        const northWall = this.createWall(this.ARENA_SIZE, this.ARENA_WALL_HEIGHT, wallMaterial);
        northWall.position.set(0, this.ARENA_WALL_HEIGHT / 2, -this.ARENA_SIZE / 2);
        arenaGroup.add(northWall);

        // South wall
        const southWall = this.createWall(this.ARENA_SIZE, this.ARENA_WALL_HEIGHT, wallMaterial);
        southWall.position.set(0, this.ARENA_WALL_HEIGHT / 2, this.ARENA_SIZE / 2);
        arenaGroup.add(southWall);

        // East wall
        const eastWall = this.createWall(this.ARENA_SIZE, this.ARENA_WALL_HEIGHT, wallMaterial);
        eastWall.rotation.y = Math.PI / 2;
        eastWall.position.set(this.ARENA_SIZE / 2, this.ARENA_WALL_HEIGHT / 2, 0);
        arenaGroup.add(eastWall);

        // West wall
        const westWall = this.createWall(this.ARENA_SIZE, this.ARENA_WALL_HEIGHT, wallMaterial);
        westWall.rotation.y = Math.PI / 2;
        westWall.position.set(-this.ARENA_SIZE / 2, this.ARENA_WALL_HEIGHT / 2, 0);
        arenaGroup.add(westWall);

        this.arena = arenaGroup;
        this.scene.add(arenaGroup);
    }

    /**
     * Create a wall segment
     */
    createWall(width, height, material) {
        const wallGeometry = new THREE.BoxGeometry(width, height, 1);
        const wall = new THREE.Mesh(wallGeometry, material);
        wall.castShadow = true;
        wall.receiveShadow = true;
        return wall;
    }

    /**
     * Handle window resize
     */
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Render the scene
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Add an object to the scene
     */
    addToScene(object) {
        this.scene.add(object);
    }

    /**
     * Remove an object from the scene
     */
    removeFromScene(object) {
        this.scene.remove(object);
    }

    /**
     * Get camera reference
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get scene reference
     */
    getScene() {
        return this.scene;
    }

    /**
     * Check if position is within arena bounds
     */
    isInBounds(position) {
        const halfSize = this.ARENA_SIZE / 2 - 1; // 1 unit padding
        return Math.abs(position.x) < halfSize && Math.abs(position.z) < halfSize;
    }

    /**
     * Clamp position to arena bounds
     */
    clampToBounds(position) {
        const halfSize = this.ARENA_SIZE / 2 - 1;
        position.x = THREE.MathUtils.clamp(position.x, -halfSize, halfSize);
        position.z = THREE.MathUtils.clamp(position.z, -halfSize, halfSize);
        return position;
    }
}
