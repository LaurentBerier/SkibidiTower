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

        // Render rig ported from Polliniate3 (cool "winter" lighting):
        // directional sun, hemisphere fill, gradient sky dome, procedural
        // environment map and a Mancini lens flare locked to the sun.
        this.sunLight = null;
        this.hemisphereLight = null;
        this.skyDome = null;
        this.lensFlare = null;
        this._envTexture = null;

        // Sun placement for the Preetham sky + the directional key light. A low
        // elevation behind the field gives a brooding, stormy dusk; the same
        // vector drives the sky glow and the shadow direction so they agree.
        this.SUN_ELEVATION = 7;   // degrees above the horizon
        this.SUN_AZIMUTH = 255;   // degrees around the compass (was 165; +90° CW)
        const _phi = THREE.MathUtils.degToRad(90 - this.SUN_ELEVATION);
        const _theta = THREE.MathUtils.degToRad(this.SUN_AZIMUTH);
        this.SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, _phi, _theta);
        this.SUN_COLOR = 0xfff3dc;

        // Base tone-mapping exposure; lightning briefly flashes above this.
        this._baseExposure = 1.1;

        // Lens-flare per-frame driver scratch (the flare's screen position is
        // computed explicitly each frame — see updateLensFlare()).
        this._lensClock = new THREE.Clock();
        this._lensSunPos = new THREE.Vector3();
        this._lensProj = new THREE.Vector3();
        this._lensRaycaster = new THREE.Raycaster();
        this._lensDir = new THREE.Vector3();
        this._lensOpacity = 0;

        // Stormy-atmosphere state (torches, rain, lightning) — see
        // buildEnvironment() / updateEnvironment().
        this._torchLights = [];
        // Vertical scale of the rolling terrain (see _terrainHeightLocal).
        this._terrainAmp = 2.2;
        this._rain = null;
        this._lightningLight = null;
        this._lightningFlash = 0;
        this._nextLightning = 2 + Math.random() * 5;
        this._envTime = 0;

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
        // Background stays null so the gradient sky dome shows through.
        this.scene.background = null;
        // Classic exponential fog with sun in-scattering — a WebGL take on
        // three's webgpu_custom_fog_scattering example (see _installScatteringFog).
        // `density` drives the haze; it warms toward the sun for depth.
        this._installScatteringFog();
        this.scene.fog = new THREE.FogExp2(0x171b22, 0.05);

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
        // Render settings ported from Polliniate3 (lighting.js configureRenderer),
        // exposure nudged up so torch flames and gold accents punch through the
        // dark stormy palette.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = this._baseExposure;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.physicallyCorrectLights = true;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Setup lighting
        this.setupLighting();
        this.addLevelLights();

        // Sky dome + overcast cloud deck + procedural env map (PBR reflections).
        this.createSkyDome();
        this.buildClouds();
        this.loadEnvironment();

        // Create arena
        this.createArena();

        // Mancini lens flare — now reads as the sun straining through the
        // overcast cloud deck. Kept subtle (see updateLensFlare opacity).
        this.buildLensFlare();

        // Storm dressing: rain, lightning, flickering torches.
        this.buildEnvironment();

        // Load any custom GLB props placed in the level editor
        this.loadCustomProps();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        console.log('Scene initialized successfully');
    }

    /**
     * Setup game lighting — grim storm rig. A dim, cold "moonlight behind the
     * clouds" key light for shape and shadows, a low cool hemisphere fill, and
     * a faint ambient so nothing crushes to pure black. The warmth in the
     * scene comes from the torches added in buildEnvironment().
     */
    setupLighting() {
        // Dim cold key light (overcast daylight leaking through storm clouds).
        // Position only sets the direction toward origin; shadow frustum is
        // sized to the arena. Nudged up so silhouettes catch a cold rim even
        // on the storm-shadowed (player-facing) side of the keep.
        const sunDist = Math.max(this.ARENA_SIZE * 2, 60);
        const sun = new THREE.DirectionalLight(0x9fb2cc, 0.9);
        sun.position.copy(this.SUN_DIR).multiplyScalar(sunDist);
        sun.castShadow = true;
        const frustum = this.ARENA_SIZE * 0.9; // covers the full arena + towers
        sun.shadow.camera.left = -frustum;
        sun.shadow.camera.right = frustum;
        sun.shadow.camera.top = frustum;
        sun.shadow.camera.bottom = -frustum;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = sunDist * 2.5;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.025;
        this.scene.add(sun);
        this.scene.add(sun.target); // target defaults to origin
        this.sunLight = sun;
        this.lights.push(sun);

        // Hemisphere fill — the workhorse for this dark scene. Because it lights
        // from every sky direction at once (three.js webgl_lights_hemisphere
        // technique), it lifts the storm-shadowed faces of the keep and enemy
        // castle out of pure black without re-aiming the sun. Sky colour is a
        // brighter cool slate-blue (the visible overcast), the ground bounce a
        // warmer wet-earth brown so undersides read as lit, not crushed.
        const hemi = new THREE.HemisphereLight(0x6b7c96, 0x3a2f22, 1.25);
        hemi.position.set(0, 50, 0);
        this.scene.add(hemi);
        this.hemisphereLight = hemi;
        this.lights.push(hemi);

        // Faint ambient floor so deep shadows keep a little shape.
        const ambient = new THREE.AmbientLight(0x20242c, 0.65);
        this.scene.add(ambient);
        this.ambientLight = ambient;
        this.lights.push(ambient);

        // Dedicated lightning light — normally off, pulsed by updateEnvironment.
        const bolt = new THREE.DirectionalLight(0xdfe8ff, 0.0);
        bolt.position.set(-30, 80, -20);
        this.scene.add(bolt);
        this.scene.add(bolt.target);
        this._lightningLight = bolt;
    }

    /**
     * Iso build / overwatch view — the camera sits ~50–60 units out, so FPS fog
     * density (0.05) would fully white-out the arena. Ease fog, boost fill,
     * and hide rain/clouds so the map, towers, and enemies stay readable.
     */
    setBuildViewMode(enabled) {
        if (this._fpsFogDensity === undefined) {
            this._fpsFogDensity = this.scene.fog?.density ?? 0.05;
        }

        if (enabled) {
            if (this.scene.fog) this.scene.fog.density = 0.003;

            if (!this._buildViewLight) {
                this._buildViewLight = new THREE.HemisphereLight(0xaabbcc, 0x5a5040, 0);
                this.scene.add(this._buildViewLight);
            }
            this._buildViewLight.intensity = 1.8;

            if (this.sunLight) {
                if (this._savedSunIntensity === undefined) {
                    this._savedSunIntensity = this.sunLight.intensity;
                }
                this.sunLight.intensity = 1.35;
            }
            if (this.ambientLight) {
                if (this._savedAmbientIntensity === undefined) {
                    this._savedAmbientIntensity = this.ambientLight.intensity;
                }
                this.ambientLight.intensity = 0.9;
            }
            if (this.hemisphereLight) {
                if (this._savedHemiIntensity === undefined) {
                    this._savedHemiIntensity = this.hemisphereLight.intensity;
                }
                this.hemisphereLight.intensity = 0.95;
            }

            if (this._rain) this._rain.visible = false;
            if (this._clouds) this._clouds.visible = false;

            this._savedExposure = this.renderer.toneMappingExposure;
            this.renderer.toneMappingExposure = this._baseExposure * 1.5;
        } else {
            if (this.scene.fog) this.scene.fog.density = this._fpsFogDensity;
            if (this._buildViewLight) this._buildViewLight.intensity = 0;
            if (this.sunLight && this._savedSunIntensity !== undefined) {
                this.sunLight.intensity = this._savedSunIntensity;
            }
            if (this.ambientLight && this._savedAmbientIntensity !== undefined) {
                this.ambientLight.intensity = this._savedAmbientIntensity;
            }
            if (this.hemisphereLight && this._savedHemiIntensity !== undefined) {
                this.hemisphereLight.intensity = this._savedHemiIntensity;
            }
            if (this._rain) this._rain.visible = true;
            if (this._clouds) this._clouds.visible = true;
            this.renderer.toneMappingExposure = this._savedExposure ?? this._baseExposure;
        }
    }

    /** @deprecated Use setBuildViewMode */
    setBuildViewLighting(enabled) {
        this.setBuildViewMode(enabled);
    }

    /**
     * Gradient sky-dome material (cool winter palette) — WebGL port of
     * Polliniate3's shaders.js createSkyMaterial. Pale icy horizon fading up
     * into deeper daylight blue, with a warm sun-proximity halo + core.
     */
    /**
     * Scattering fog (WebGL equivalent of three's webgpu_custom_fog_scattering):
     * overrides three's fog shader chunks so every fogged material gets classic
     * exponential FogExp2 density PLUS sun in-scattering — the haze brightens
     * toward the sun direction for atmospheric depth. The sun direction and warm
     * scatter colour are baked in as GLSL constants, so no per-material uniforms
     * are needed. Must run before any material compiles (called from initialize).
     *
     * Tunables: fog colour/density via `scene.fog`; scatter colour, the `pow(…,5.0)`
     * tightness, and the `* 0.75` strength below.
     */
    _installScatteringFog() {
        if (THREE.ShaderChunk.__scatterFogInstalled) return;
        const s = this.SUN_DIR;
        const sx = s.x.toFixed(5), sy = s.y.toFixed(5), sz = s.z.toFixed(5);

        THREE.ShaderChunk.fog_pars_vertex = `
            #ifdef USE_FOG
                varying float vFogDepth;
                varying vec3 vFogWorldPos;
            #endif
        `;
        THREE.ShaderChunk.fog_vertex = `
            #ifdef USE_FOG
                vFogDepth = - mvPosition.z;
                vFogWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
            #endif
        `;
        THREE.ShaderChunk.fog_pars_fragment = `
            #ifdef USE_FOG
                uniform vec3 fogColor;
                varying float vFogDepth;
                varying vec3 vFogWorldPos;
                #ifdef FOG_EXP2
                    uniform float fogDensity;
                #else
                    uniform float fogNear;
                    uniform float fogFar;
                #endif
            #endif
        `;
        THREE.ShaderChunk.fog_fragment = `
            #ifdef USE_FOG
                #ifdef FOG_EXP2
                    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
                #else
                    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
                #endif
                // Sun in-scattering: warm the haze toward the sun direction.
                vec3 fogViewDir = normalize( vFogWorldPos - cameraPosition );
                float fogScatter = pow( max( dot( fogViewDir, vec3( ${sx}, ${sy}, ${sz} ) ), 0.0 ), 5.0 );
                vec3 scatteredFog = mix( fogColor, vec3( 1.0, 0.74, 0.45 ), fogScatter * 0.75 );
                gl_FragColor.rgb = mix( gl_FragColor.rgb, scatteredFog, clamp( fogFactor, 0.0, 1.0 ) );
            #endif
        `;
        THREE.ShaderChunk.__scatterFogInstalled = true;
    }

    createSkyMaterial() {
        this._skyMaterial = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                // Dark storm palette: faint sickly glow near the horizon (distant
                // light behind the castle) fading up into near-black cloud cover.
                uHorizon: { value: new THREE.Color('#3b3f4b') },
                uZenith:  { value: new THREE.Color('#0c0e14') },
                uGlowTint:{ value: new THREE.Color('#b9863f') },
                uFlash:   { value: 0.0 },
                uFlashColor: { value: new THREE.Color('#cdd8ff') },
            },
            vertexShader: `
                varying vec3 vLocalPos;
                void main() {
                    vLocalPos = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uHorizon;
                uniform vec3 uZenith;
                uniform vec3 uGlowTint;
                uniform float uFlash;
                uniform vec3 uFlashColor;
                varying vec3 vLocalPos;

                // Cheap value-noise FBM for rolling cloud banding.
                float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float noise(vec2 p){
                    vec2 i = floor(p), f = fract(p);
                    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }
                float fbm(vec2 p){
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
                    return v;
                }

                void main() {
                    vec3 dir = normalize(vLocalPos);
                    float elev = clamp(dir.y, 0.0, 1.0);
                    // Vertical gradient horizon → zenith.
                    float mixT = pow(smoothstep(-0.1, 0.7, dir.y), 0.8);
                    vec3 baseColor = mix(uHorizon, uZenith, mixT);

                    // Warm low glow hugging the horizon (the besieged-keep light).
                    float glow = pow(1.0 - elev, 6.0) * 0.35;
                    baseColor += uGlowTint * glow;

                    // Cloud texture, heavier overhead, projected on the dome.
                    vec2 uv = dir.xz / (abs(dir.y) + 0.35);
                    float clouds = fbm(uv * 1.8);
                    clouds = smoothstep(0.45, 0.95, clouds) * smoothstep(0.0, 0.4, dir.y);
                    baseColor = mix(baseColor, baseColor * 0.55, clouds * 0.7);

                    // Lightning wash brightens the whole dome briefly.
                    baseColor += uFlashColor * uFlash * (0.5 + 0.5 * elev);

                    gl_FragColor = vec4(baseColor, 1.0);
                }
            `,
        });
        return this._skyMaterial;
    }

    /**
     * Sky dome. Uses the Three.js Preetham atmospheric Sky shader
     * (threejs.org/examples/#webgl_shaders_sky), tuned for a brooding, hazy
     * storm dusk: high turbidity, low rayleigh and a low sun. Its vertex shader
     * pins depth to the far plane, so the large scale renders fine despite the
     * camera's 1000-unit far plane. Falls back to the gradient dome if the
     * Sky.js script didn't load.
     */
    createSkyDome() {
        if (typeof THREE.Sky === 'function') {
            const sky = new THREE.Sky();
            sky.scale.setScalar(10000);
            sky.frustumCulled = false;
            sky.renderOrder = -1000;
            sky.userData = { lensflare: 'no-occlusion' };
            const u = sky.material.uniforms;
            // Muted base sky — the cloud deck (buildClouds) provides the
            // overcast cover and the sun patch, so we keep the Preetham layer
            // dim and only lightly tinted.
            u['turbidity'].value = 8;
            u['rayleigh'].value = 0.3;        // minimal scatter → dark grey dome
            u['mieCoefficient'].value = 0.005;// muted sun halo
            u['mieDirectionalG'].value = 0.82;
            u['sunPosition'].value.copy(this.SUN_DIR);
            this._skyUniforms = u;
            this.skyDome = sky;
            this.scene.add(sky);
            return;
        }

        // Fallback: procedural gradient dome (if Sky.js failed to load).
        const radius = Math.min(500, this.ARENA_SIZE * 10);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32), this.createSkyMaterial());
        mesh.frustumCulled = false;
        mesh.renderOrder = -1000;
        mesh.userData = { lensflare: 'no-occlusion' };
        this.skyDome = mesh;
        this.scene.add(mesh);
    }

    /**
     * Overcast cloud deck — a transparent BackSide dome (inside the camera far
     * plane) drawn over the Preetham sky. A drifting FBM noise field gives a
     * heavy, rolling grey cloud cover that thins toward the horizon (so the
     * sky's light band still shows beneath it) and brightens toward the hidden
     * sun. Terrain/towers occlude it normally (depthTest on, depthWrite off).
     */
    buildClouds() {
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            fog: false,
            uniforms: {
                uTime: { value: 0 },
                uSunDir: { value: this.SUN_DIR.clone() },
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uSunDir;
                varying vec3 vDir;

                float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                float noise(vec2 p){
                    vec2 i = floor(p), f = fract(p);
                    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }
                float fbm(vec2 p){
                    float v = 0.0, a = 0.5;
                    for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
                    return v;
                }

                void main() {
                    vec3 dir = normalize(vDir);
                    // Fade clouds out below/at the horizon so the sky's light
                    // band shows beneath the deck (and no hard dome rim).
                    float horizonFade = smoothstep(0.02, 0.42, dir.y);
                    if (horizonFade <= 0.0) discard;

                    // "Cloud ceiling" projection: looking up samples a plane.
                    vec2 uv = dir.xz / (dir.y * 0.8 + 0.32);
                    uv *= 1.35;
                    // Fast-scudding storm drift.
                    float t = uTime * 0.22;
                    float n  = fbm(uv + vec2(t, t * 0.5));
                    float n2 = fbm(uv * 2.3 + vec2(-t * 1.1, t * 0.6) + 9.0);

                    // Near-total overcast coverage.
                    float cov = smoothstep(0.08, 0.58, n * 0.7 + n2 * 0.3);
                    float density = cov * horizonFade;

                    // Very dark, bruised grey; only faintly lighter billows on top.
                    vec3 col = mix(vec3(0.022, 0.026, 0.036), vec3(0.15, 0.16, 0.20), n2);
                    // Sun straining through the deck.
                    float sd = max(dot(dir, uSunDir), 0.0);
                    col += vec3(0.8, 0.6, 0.38) * pow(sd, 12.0) * 0.4;

                    gl_FragColor = vec4(col, density);
                }
            `,
        });

        const dome = new THREE.Mesh(new THREE.SphereGeometry(470, 48, 32), mat);
        dome.frustumCulled = false;
        dome.renderOrder = -500; // over the sky, under the scene
        dome.userData = { lensflare: 'no-occlusion' };
        this._cloudMat = mat;
        this._clouds = dome;
        this.scene.add(dome);
    }

    /**
     * Procedural cool-sky gradient environment map (canvas → equirect),
     * ported from Polliniate3 lighting.js. Gives PBR materials a plausible
     * cool sky to reflect without an HDRI fetch.
     */
    loadEnvironment() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0.00, '#1c2230'); // storm zenith (lifted off black)
        grad.addColorStop(0.45, '#46505f'); // brighter slate band above horizon
        grad.addColorStop(0.55, '#574c38'); // warmer horizon glow
        grad.addColorStop(1.00, '#241e15'); // wet-earth ground hemisphere
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tex = new THREE.CanvasTexture(canvas);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        this._envTexture = tex;
        this.scene.environment = tex;
    }

    /**
     * Mancini lens flare (js/lensFlare.js) locked to the sun direction.
     * The container's onBeforeRender projects the sun to screen space and
     * damps opacity every frame, so just adding it to the scene is enough.
     */
    buildLensFlare() {
        if (typeof LensFlareEffect !== 'function') {
            console.warn('LensFlareEffect not loaded — skipping lens flare.');
            return;
        }
        // Anchor the flare at the sun direction, inside the camera far plane.
        const lensPos = this.SUN_DIR.clone().multiplyScalar(500);

        this.lensFlare = LensFlareEffect(
            true,                          // enabled
            lensPos,                       // lensPosition (Vector3)
            1.0,                           // opacity — library damps internally
            new THREE.Color(120, 40, 20),  // colorGain — warm golden tint
            6.0,                           // starPoints
            0.75,                          // glareSize
            0.006,                         // flareSize
            0.4,                           // flareSpeed
            1.2,                           // flareShape
            0.7,                           // haloScale
            true,                          // animated
            false,                         // anamorphic
            true,                          // secondaryGhosts
            false,                         // starBurst (heaviest feature — off)
            0.4,                           // ghostScale
            false,                         // aditionalStreaks (heavy — off)
            false                          // followMouse
        );
        this.lensFlare.renderOrder = 999;
        this.lensFlare.frustumCulled = false;
        // Skip raycast occlusion — the sun-projection guard (z < 1) still hides
        // the flare when the sun is behind the camera.
        this.lensFlare.userData = { skipRaycast: true };
        this.scene.add(this.lensFlare);
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
    /**
     * Build the battlefield: a rugged, displaced mud/stone field (no walls),
     * scattered boulders, and a few wet puddles. Purely visual relief — all
     * gameplay (player, enemies, turrets, aiming) runs on the flat y=0 plane,
     * so the displacement is kept gentle and flattened near the central keep.
     */
    /**
     * Smooth rolling height field, shared by the visual mesh and runtime
     * collision queries (getGroundHeight) so what you see is what you walk on.
     * Inputs are LOCAL plane coords; after the mesh's -90° X rotation,
     * world x = local x and world z = -local y, and local z is world height.
     * A disc around the keep is kept flat for clean gameplay near the base.
     */
    _terrainHeightLocal(x, y) {
        const r = Math.sqrt(x * x + y * y);
        const flat = Math.min(1, Math.max(0, (r - 9) / 18));
        const fall = flat * flat * (3 - 2 * flat); // smoothstep ramp from the keep
        // Low-frequency only → broad, smooth dunes (no jagged rock facets).
        const h = Math.sin(x * 0.09) * Math.cos(y * 0.075)
                + 0.5 * Math.sin((x + y) * 0.055 + 1.7);
        return h * this._terrainAmp * fall;
    }

    /** World-space ground height at (x, z). Used for player/enemy/coin/turret placement. */
    getGroundHeight(x, z) {
        return this._terrainHeightLocal(x, -z);
    }

    createArena() {
        const arenaGroup = new THREE.Group();
        const S = this.ARENA_SIZE;

        // ── Smooth displaced ground ───────────────────────────────────────
        const segs = Math.min(140, Math.round(S * 1.5));
        const geo = new THREE.PlaneGeometry(S * 1.3, S * 1.3, segs, segs);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            pos.setZ(i, this._terrainHeightLocal(pos.getX(i), pos.getY(i)));
        }
        geo.computeVertexNormals();
        // Smooth shading (flatShading off) removes the hard faceted edges.
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x241f18, roughness: 1.0, metalness: 0.0,
        });
        const ground = new THREE.Mesh(geo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        arenaGroup.add(ground);
        this.terrain = ground;

        // ── Wet puddles in the flat central play area (lie flush on ground) ─
        const puddleMat = new THREE.MeshStandardMaterial({
            color: 0x0a0c10, roughness: 0.08, metalness: 0.7,
        });
        for (let i = 0; i < 5; i++) {
            const ang = Math.random() * Math.PI * 2;
            const rad = 3 + Math.random() * 5; // within the flat disc (r < 9)
            const puddle = new THREE.Mesh(
                new THREE.CircleGeometry(1.0 + Math.random() * 1.8, 20),
                puddleMat
            );
            puddle.rotation.x = -Math.PI / 2;
            puddle.position.set(Math.cos(ang) * rad, 0.03, Math.sin(ang) * rad);
            arenaGroup.add(puddle);
        }

        this.arena = arenaGroup;
        this.scene.add(arenaGroup);
    }

    /**
     * Storm dressing — rain, lightning rig already created in setupLighting,
     * and warm flickering torches ringing the keep. Driven by updateEnvironment().
     */
    /**
     * Soft teardrop flame gradient as a CanvasTexture — bright cream core
     * fading through gold to a transparent orange edge. Drawn once and shared
     * by every torch sprite layer; the warm tint per layer comes from the
     * SpriteMaterial color.
     */
    _makeFlameTexture() {
        if (this._flameTexture) return this._flameTexture;
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const ctx = cv.getContext('2d');
        const g = ctx.createRadialGradient(32, 36, 2, 32, 36, 30);
        g.addColorStop(0.00, 'rgba(255,255,248,1.0)');
        g.addColorStop(0.30, 'rgba(255,228,158,0.95)');
        g.addColorStop(0.60, 'rgba(255,150,46,0.55)');
        g.addColorStop(1.00, 'rgba(255,90,20,0.0)');
        // Teardrop: wider/rounder at the base, tapering upward.
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(32, 38, 22, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(32, 2);
        ctx.quadraticCurveTo(50, 26, 32, 40);
        ctx.quadraticCurveTo(14, 26, 32, 2);
        ctx.fill();
        const tex = new THREE.CanvasTexture(cv);
        tex.needsUpdate = true;
        this._flameTexture = tex;
        return tex;
    }

    buildEnvironment() {
        const S = this.ARENA_SIZE;

        // ── Torches around the central keep ───────────────────────────────
        const torchRing = 6;
        const torchRadius = 5.5;
        const flameTex = this._makeFlameTexture();
        // Stacked, additive, camera-facing flame layers: soft orange glow,
        // an orange body, and a bright cream core (matching the reference).
        const FLAME_LAYERS = [
            { sx: 1.10, sy: 1.55, color: 0xff5f17, opacity: 0.40 }, // outer glow
            { sx: 0.74, sy: 1.10, color: 0xffa53a, opacity: 0.80 }, // flame body
            { sx: 0.42, sy: 0.64, color: 0xfff3d4, opacity: 1.00 }, // cream core
        ];
        for (let i = 0; i < torchRing; i++) {
            const ang = (i / torchRing) * Math.PI * 2;
            const px = Math.cos(ang) * torchRadius;
            const pz = Math.sin(ang) * torchRadius;

            // Wooden post.
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6),
                new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 1.0 })
            );
            post.position.set(px, 1.1, pz);
            post.castShadow = true;
            this.scene.add(post);

            // Flame: a small group of additive sprites at the post top.
            const flameGroup = new THREE.Group();
            flameGroup.position.set(px, 2.35, pz);
            const layers = [];
            for (const d of FLAME_LAYERS) {
                const mat = new THREE.SpriteMaterial({
                    map: flameTex, color: d.color, transparent: true,
                    opacity: d.opacity, blending: THREE.AdditiveBlending,
                    depthWrite: false, fog: false,
                });
                const spr = new THREE.Sprite(mat);
                spr.scale.set(d.sx, d.sy, 1);
                spr.position.y = d.sy * 0.35; // taller layers lick upward
                flameGroup.add(spr);
                layers.push({ spr, sx: d.sx, sy: d.sy, opacity: d.opacity, baseY: spr.position.y });
            }
            this.scene.add(flameGroup);

            // Warm flickering point light.
            const light = new THREE.PointLight(0xff8a2e, 1.8, 18, 2);
            light.position.set(px, 2.5, pz);
            this.scene.add(light);
            this._torchLights.push({ light, flameGroup, layers, base: 1.8, phase: Math.random() * 10 });
        }

        // ── Rain (camera-following world-space points) ────────────────────
        const count = 1400;
        this._rainCount = count;
        this._rainBox = { x: 36, yUp: 16, yDown: 22, z: 36 };
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3]     = (Math.random() * 2 - 1) * this._rainBox.x;
            positions[i * 3 + 1] = (Math.random() * 2 - 1) * this._rainBox.yUp;
            positions[i * 3 + 2] = (Math.random() * 2 - 1) * this._rainBox.z;
        }
        const rainGeo = new THREE.BufferGeometry();
        rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const rainMat = new THREE.PointsMaterial({
            color: 0xaab6c8, size: 0.07, transparent: true, opacity: 0.5,
            depthWrite: false,
        });
        const rain = new THREE.Points(rainGeo, rainMat);
        rain.frustumCulled = false;
        this.scene.add(rain);
        this._rain = rain;
        this._rainPositions = positions;
        this._rainSeeded = false;
    }

    /**
     * Per-frame storm update: torch flicker, falling rain that follows the
     * camera, and random lightning that flashes the sky + bolt light + fog.
     * Called from the game loop with the camera position.
     */
    updateEnvironment(dt, cameraPos) {
        this._envTime += dt;

        // Drift the overcast cloud deck.
        if (this._cloudMat) this._cloudMat.uniforms.uTime.value = this._envTime;

        // ── Torch flicker ─────────────────────────────────────────────────
        for (const t of this._torchLights) {
            // Composite flicker in [~0.4, ~1.1]: slow breath + fast jitter.
            const f = 0.7 + 0.25 * Math.sin(this._envTime * 11 + t.phase)
                          + 0.12 * Math.sin(this._envTime * 27 + t.phase * 2)
                          + 0.06 * Math.sin(this._envTime * 53 + t.phase * 3);
            t.light.intensity = t.base * (0.65 + f * 0.55);
            const tall = 0.78 + f * 0.45;  // vertical lick
            const sway = Math.sin(this._envTime * 9 + t.phase) * 0.05;
            for (let li = 0; li < t.layers.length; li++) {
                const L = t.layers[li];
                L.spr.scale.set(L.sx * (0.9 + f * 0.18), L.sy * tall, 1);
                L.spr.material.opacity = L.opacity * (0.68 + f * 0.4);
                // Inner layers sway a touch more than the outer glow.
                L.spr.position.x = sway * (li + 1) * 0.6;
                L.spr.position.y = L.baseY + (tall - 1) * L.sy * 0.5;
            }
        }

        // ── Rain ──────────────────────────────────────────────────────────
        if (this._rain && cameraPos) {
            const p = this._rainPositions;
            const box = this._rainBox;
            const cx = cameraPos.x, cy = cameraPos.y, cz = cameraPos.z;
            if (!this._rainSeeded) {
                for (let i = 0; i < this._rainCount; i++) {
                    p[i * 3]     = cx + (Math.random() * 2 - 1) * box.x;
                    p[i * 3 + 1] = cy + (Math.random() * 2 - 1) * box.yUp;
                    p[i * 3 + 2] = cz + (Math.random() * 2 - 1) * box.z;
                }
                this._rainSeeded = true;
            }
            const fall = 38 * dt;
            const drift = 4 * dt; // wind slant
            for (let i = 0; i < this._rainCount; i++) {
                const i3 = i * 3;
                p[i3 + 1] -= fall;
                p[i3] += drift;
                // Recycle particles that fall below / drift past the camera box.
                if (p[i3 + 1] < cy - box.yDown) {
                    p[i3]     = cx + (Math.random() * 2 - 1) * box.x;
                    p[i3 + 1] = cy + box.yUp;
                    p[i3 + 2] = cz + (Math.random() * 2 - 1) * box.z;
                } else if (p[i3] > cx + box.x) {
                    p[i3] = cx - box.x;
                }
            }
            this._rain.geometry.attributes.position.needsUpdate = true;
        }

        // ── Lightning ─────────────────────────────────────────────────────
        this._nextLightning -= dt;
        if (this._nextLightning <= 0) {
            // New strike: short multi-flicker, then a long pause.
            this._lightningFlash = 1.0;
            this._nextLightning = 4 + Math.random() * 9;
        }
        if (this._lightningFlash > 0) {
            // Flickery decay so it reads as a real bolt, not a fade. The bolt
            // light pulses the geometry while a brief exposure lift flashes the
            // whole frame (sky included) — our stand-in for the gradient uFlash.
            this._lightningFlash -= dt * (3.5 + Math.random() * 3.0);
            const v = Math.max(0, this._lightningFlash);
            const flick = v * (0.6 + 0.4 * Math.sin(this._envTime * 90));
            if (this._lightningLight) this._lightningLight.intensity = flick * 3.2;
            this.renderer.toneMappingExposure = this._baseExposure + flick * 0.7;
        } else if (this._lightningLight && this._lightningLight.intensity !== 0) {
            this._lightningLight.intensity = 0;
            this.renderer.toneMappingExposure = this._baseExposure;
        }
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
     * Drive the lens flare from the sun's projected screen position.
     *
     * The vendored flare expects Material.onBeforeRender to project the sun
     * and update its `lensPosition` uniform, but that callback isn't invoked
     * in this Three.js (r128) build — without this the uniform stays at its
     * (0,0) init, locking the flare to screen center. So we project the sun
     * ourselves each frame (mirrors Polliniate3's render-loop driver).
     */
    updateLensFlare() {
        if (!this.lensFlare || !this.sunLight) return;
        const u = this.lensFlare.material.uniforms;

        // Sun world position (direction anchored inside the camera far plane).
        this._lensSunPos.copy(this.SUN_DIR).multiplyScalar(500);
        this._lensProj.copy(this._lensSunPos).project(this.camera);

        const onScreen =
            this._lensProj.z < 1 &&
            this._lensProj.x > -1.5 && this._lensProj.x < 1.5 &&
            this._lensProj.y > -1.5 && this._lensProj.y < 1.5;

        // Occlusion: cast a ray from the camera toward the sun. Any solid mesh
        // in the way (terrain, keep, spire, turrets, enemies) hides the flare.
        // VFX (sprites/points/lines), the sky/cloud/flare shader meshes, and
        // the first-person weapon are excluded.
        let occluded = false;
        if (onScreen) {
            this._lensRaycaster.set(this.camera.position, this._lensDir.copy(this.SUN_DIR).normalize());
            this._lensRaycaster.far = 2000;
            this._lensRaycaster.camera = this.camera; // Sprite.raycast needs this
            const hits = this._lensRaycaster.intersectObjects(this.scene.children, true);
            for (let i = 0; i < hits.length; i++) {
                const o = hits[i].object;
                if (!o || o === this.lensFlare) continue;
                if (o.isSprite || o.isPoints || o.isLine) continue;
                if (o.material && o.material.isShaderMaterial) continue;
                if (o.userData && o.userData.lensflare === 'no-occlusion') continue;
                if (this._isUnderCamera(o)) continue;
                occluded = true;
                break;
            }
        }

        // Smooth fade so occluders wipe the flare cleanly instead of popping.
        const target = (onScreen && !occluded) ? 0.32 : 0.0;
        this._lensOpacity += (target - this._lensOpacity) * 0.18;
        this.lensFlare.visible = this._lensOpacity > 0.003;
        if (!this.lensFlare.visible) return;

        u.lensPosition.value.set(this._lensProj.x, this._lensProj.y);
        u.iTime.value = this._lensClock.getElapsedTime();
        u.iResolution.value.set(window.innerWidth, window.innerHeight);
        u.opacity.value = this._lensOpacity;
    }

    /** True if `obj` is in the camera's subtree (e.g. the first-person weapon). */
    _isUnderCamera(obj) {
        let p = obj;
        while (p) { if (p === this.camera) return true; p = p.parent; }
        return false;
    }

    /**
     * Render the scene
     */
    render() {
        this.updateLensFlare();
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
