/**
 * zbEffects.js - Visual effects system ported from ZombieBlaster (effects.js)
 *
 * Pooled comic-book particles: hit bursts, death splats, floating damage
 * numbers, explosions, smoke/plasma/droplet trails, acid pools, chain
 * lightning, and screen shake. Exposed as the global `ZBEffects`.
 *
 * Call ZBEffects.init(scene) once after the scene exists, ZBEffects.update(dt)
 * each frame, and the spawn* helpers from the weapon hit pipeline. Screen shake
 * is read by the render loop via getScreenShakeOffset().
 */
(function () {
    let scene = null;

    const C = () => window.ZB_COLORS;

    const POPUP_TEXTS = ['POW!', 'ZAP!', 'SPLAT!', 'BOOM!', 'WHAM!', 'CRACK!'];
    let POPUP_COLORS = [];

    const popups = [];
    const MAX_POPUPS = 20;
    const particles = [];
    const MAX_PARTICLES = 100;
    const deathSplats = [];
    const MAX_SPLATS = 15;
    const damageNumbers = [];
    const MAX_DAMAGE_NUMBERS = 30;
    const explosions = [];
    const MAX_EXPLOSIONS = 8;
    const smokePuffs = [];
    const MAX_SMOKE = 60;
    const plasmaTrails = [];
    const MAX_PLASMA_TRAILS = 40;
    const liquidSplashes = [];
    const MAX_LIQUID_SPLASHES = 140;
    const acidPools = [];
    const MAX_ACID_POOLS = 10;
    const chainLightnings = [];
    const MAX_CHAIN_LIGHTNINGS = 6;

    const screenShake = {
        amplitude: 0,
        duration: 0,
        elapsed: 0,
        offset: new THREE.Vector3(),
    };

    function init(sceneRef) {
        scene = sceneRef;
        const COLORS = C();
        POPUP_COLORS = [COLORS.yellow, COLORS.cyan, COLORS.hotPink, COLORS.magenta, COLORS.orange, COLORS.lime];

        for (let i = 0; i < MAX_POPUPS; i++) {
            const popup = createPopupSprite();
            popup.visible = false;
            scene.add(popup);
            popups.push({ sprite: popup, active: false, lifetime: 0, velocity: new THREE.Vector3() });
        }

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const particleGeo = new THREE.SphereGeometry(0.05, 4, 4);
            const particleMat = new THREE.MeshBasicMaterial({ color: COLORS.yellow });
            const particle = new THREE.Mesh(particleGeo, particleMat);
            particle.visible = false;
            scene.add(particle);
            particles.push({ mesh: particle, active: false, lifetime: 0, velocity: new THREE.Vector3(), drag: 0.95 });
        }

        for (let i = 0; i < MAX_SPLATS; i++) {
            const splatGeo = new THREE.CircleGeometry(0.5, 8);
            const splatMat = zbCreateToonMaterial(COLORS.hotPink, COLORS.hotPink, 0.5);
            splatMat.transparent = true;
            splatMat.opacity = 0.8;
            const splat = new THREE.Mesh(splatGeo, splatMat);
            splat.rotation.x = -Math.PI / 2;
            splat.visible = false;
            scene.add(splat);
            deathSplats.push({ mesh: splat, active: false, lifetime: 0 });
        }

        for (let i = 0; i < MAX_DAMAGE_NUMBERS; i++) {
            const sprite = createDamageNumberSprite();
            sprite.visible = false;
            scene.add(sprite);
            damageNumbers.push({ sprite, active: false, lifetime: 0, maxLifetime: 0.8, velocity: new THREE.Vector3(), isCritical: false });
        }

        for (let i = 0; i < MAX_EXPLOSIONS; i++) {
            const group = new THREE.Group();
            const flashGeo = new THREE.SphereGeometry(1, 12, 12);
            const flashMat = new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 1.0, depthWrite: false });
            const flash = new THREE.Mesh(flashGeo, flashMat);
            group.add(flash);
            const ringGeo = new THREE.RingGeometry(0.9, 1.0, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.yellow, transparent: true, opacity: 1.0, side: THREE.DoubleSide, depthWrite: false });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = -Math.PI / 2;
            group.add(ring);
            group.visible = false;
            scene.add(group);
            explosions.push({ group, flash, ring, active: false, lifetime: 0, maxLifetime: 0.45, targetRadius: 1.0 });
        }

        for (let i = 0; i < MAX_SMOKE; i++) {
            const smokeGeo = new THREE.SphereGeometry(0.18, 6, 6);
            const smokeMat = new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true, opacity: 0.7, depthWrite: false });
            const smoke = new THREE.Mesh(smokeGeo, smokeMat);
            smoke.visible = false;
            scene.add(smoke);
            smokePuffs.push({ mesh: smoke, active: false, lifetime: 0, maxLifetime: 0.8, velocity: new THREE.Vector3() });
        }

        for (let i = 0; i < MAX_PLASMA_TRAILS; i++) {
            const trailGeo = new THREE.SphereGeometry(0.22, 6, 6);
            const trailMat = new THREE.MeshBasicMaterial({ color: COLORS.magenta, transparent: true, opacity: 0.6, depthWrite: false });
            const trail = new THREE.Mesh(trailGeo, trailMat);
            trail.visible = false;
            scene.add(trail);
            plasmaTrails.push({ mesh: trail, active: false, lifetime: 0, maxLifetime: 0.25 });
        }

        for (let i = 0; i < MAX_LIQUID_SPLASHES; i++) {
            const dropGeo = new THREE.SphereGeometry(0.1, 5, 5);
            const dropMat = new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.9, depthWrite: false });
            const drop = new THREE.Mesh(dropGeo, dropMat);
            drop.visible = false;
            scene.add(drop);
            liquidSplashes.push({ mesh: drop, active: false, lifetime: 0, maxLifetime: 0.5, velocity: new THREE.Vector3() });
        }

        for (let i = 0; i < MAX_ACID_POOLS; i++) {
            const poolGeo = new THREE.CircleGeometry(1, 16);
            const poolMat = new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
            const poolMesh = new THREE.Mesh(poolGeo, poolMat);
            poolMesh.rotation.x = -Math.PI / 2;
            poolMesh.visible = false;
            scene.add(poolMesh);
            acidPools.push({ mesh: poolMesh, active: false, lifetime: 0, maxLifetime: 2.0, radius: 1.0, dps: 5, tickTimer: 0, position: new THREE.Vector3() });
        }

        for (let i = 0; i < MAX_CHAIN_LIGHTNINGS; i++) {
            const positions = new Float32Array(384);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geo.setDrawRange(0, 0);
            const mat = new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 1.0, linewidth: 2 });
            const lines = new THREE.LineSegments(geo, mat);
            lines.visible = false;
            lines.frustumCulled = false;
            scene.add(lines);
            chainLightnings.push({ lines, positions, active: false, lifetime: 0, maxLifetime: 0.14 });
        }
    }

    function createDamageNumberSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.2, 0.6, 1);
        sprite.userData = { canvas, ctx, texture };
        return sprite;
    }

    function drawDamageNumber(sprite, damage, isCritical) {
        const { canvas, ctx, texture } = sprite.userData;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const text = Math.round(damage).toString();
        const fontSize = isCritical ? 42 : 30;
        ctx.font = `900 ${fontSize}px "Bangers", "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#000';
        ctx.strokeText(text, 64, 32);
        ctx.fillStyle = isCritical ? '#FFEE44' : '#FFFFFF';
        ctx.fillText(text, 64, 32);
        texture.needsUpdate = true;
    }

    function createPopupSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(2, 1, 1);
        sprite.userData = { canvas, ctx, texture };
        return sprite;
    }

    function updatePopupTexture(sprite, text, color) {
        const { canvas, ctx, texture } = sprite.userData;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(128, 64);
        const points = 12;
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i * Math.PI) / points;
            const radius = i % 2 === 0 ? 60 : 40;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius * 0.7;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const colorStr = '#' + color.toString(16).padStart(6, '0');
        ctx.fillStyle = colorStr;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.font = 'bold 36px "Bangers", "Arial Black", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = '#FFF';
        ctx.fillText(text, 0, 0);
        ctx.restore();
        texture.needsUpdate = true;
    }

    function spawnPopup(position, isCritical = false) {
        const popup = popups.find(p => !p.active);
        if (!popup) return;
        popup.active = true;
        popup.lifetime = 0.8;
        const textIdx = isCritical ? 0 : Math.floor(Math.random() * POPUP_TEXTS.length);
        const colorIdx = textIdx % POPUP_COLORS.length;
        updatePopupTexture(popup.sprite, POPUP_TEXTS[textIdx], POPUP_COLORS[colorIdx]);
        popup.sprite.position.copy(position);
        popup.sprite.position.y += 0.2 + Math.random() * 0.15;
        popup.sprite.visible = true;
        popup.sprite.scale.set(0.1, 0.05, 1);
        popup.velocity.set((Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2);
    }

    function spawnHitParticles(position, color, count = 8) {
        for (let i = 0; i < count; i++) {
            const p = particles.find(p => !p.active);
            if (!p) break;
            p.active = true;
            p.lifetime = 0.3 + Math.random() * 0.3;
            p.mesh.material.color.setHex(color);
            p.mesh.position.copy(position);
            p.mesh.visible = true;
            p.mesh.scale.setScalar(0.5 + Math.random() * 1.0);
            p.velocity.set((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8);
        }
    }

    function spawnDeathSplat(position) {
        let splat = deathSplats.find(s => !s.active);
        if (!splat) {
            const oldest = deathSplats.reduce((a, b) => a.lifetime < b.lifetime ? a : b);
            oldest.active = false;
            splat = oldest;
        }
        splat.active = true;
        splat.lifetime = 5.0;
        splat.mesh.position.set(position.x, 0.03, position.z);
        splat.mesh.visible = true;
        splat.mesh.material.opacity = 0.8;
        const scale = 0.5 + Math.random() * 1.0;
        splat.mesh.scale.set(scale, scale, scale);
        splat.mesh.rotation.z = Math.random() * Math.PI * 2;
        const COLORS = C();
        const colors = [COLORS.hotPink, COLORS.magenta, 0xff3366];
        splat.mesh.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
    }

    function spawnDamageNumber(position, damage, isCritical = false) {
        const entry = damageNumbers.find(d => !d.active);
        if (!entry) return;
        entry.active = true;
        entry.lifetime = 0.8;
        entry.maxLifetime = 0.8;
        entry.isCritical = isCritical;
        drawDamageNumber(entry.sprite, damage, isCritical);
        entry.sprite.position.copy(position);
        entry.sprite.position.y += 0.25 + Math.random() * 0.15;
        entry.sprite.position.x += (Math.random() - 0.5) * 0.4;
        entry.sprite.scale.set(isCritical ? 1.6 : 1.1, isCritical ? 0.8 : 0.55, 1);
        entry.sprite.material.opacity = 1.0;
        entry.sprite.visible = true;
        entry.velocity.set((Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
    }

    function triggerScreenShake(amplitude, duration) {
        if (amplitude > screenShake.amplitude || duration > screenShake.duration) {
            screenShake.amplitude = Math.max(screenShake.amplitude, amplitude);
            screenShake.duration = Math.max(screenShake.duration, duration);
            screenShake.elapsed = 0;
        }
    }

    function updateScreenShake(dt) {
        if (screenShake.duration <= 0) {
            screenShake.offset.set(0, 0, 0);
            return;
        }
        screenShake.elapsed += dt;
        screenShake.duration -= dt;
        const remaining = Math.max(0, screenShake.duration);
        const falloff = remaining / (remaining + screenShake.elapsed + 0.0001);
        const amp = screenShake.amplitude * falloff;
        screenShake.offset.set(
            (Math.random() - 0.5) * amp,
            (Math.random() - 0.5) * amp * 0.6,
            (Math.random() - 0.5) * amp
        );
        if (screenShake.duration <= 0) {
            screenShake.amplitude = 0;
            screenShake.elapsed = 0;
            screenShake.offset.set(0, 0, 0);
        }
    }

    function getScreenShakeOffset() {
        return screenShake.offset;
    }

    function spawnExplosion(position, radius, color) {
        const COLORS = C();
        if (color === undefined) color = COLORS.orange;
        const entry = explosions.find(e => !e.active);
        if (!entry) return;
        entry.active = true;
        entry.lifetime = entry.maxLifetime;
        entry.targetRadius = radius;
        entry.group.position.copy(position);
        entry.group.visible = true;
        entry.flash.material.color.setHex(color);
        entry.flash.material.opacity = 1.0;
        entry.flash.scale.setScalar(0.1);
        entry.ring.material.opacity = 1.0;
        entry.ring.scale.setScalar(0.1);
        for (let i = 0; i < 18; i++) {
            const p = particles.find(p => !p.active);
            if (!p) break;
            p.active = true;
            p.lifetime = 0.4 + Math.random() * 0.4;
            p.mesh.material.color.setHex(i % 3 === 0 ? COLORS.yellow : color);
            p.mesh.position.copy(position);
            p.mesh.visible = true;
            p.mesh.scale.setScalar(0.8 + Math.random() * 1.2);
            const speed = 6 + Math.random() * 6;
            const angle = Math.random() * Math.PI * 2;
            const vertical = 2 + Math.random() * 3;
            p.velocity.set(Math.cos(angle) * speed, vertical, Math.sin(angle) * speed);
        }
    }

    function spawnSmokeTrail(position) {
        const entry = smokePuffs.find(s => !s.active);
        if (!entry) return;
        entry.active = true;
        entry.lifetime = entry.maxLifetime;
        entry.mesh.position.copy(position);
        entry.mesh.position.x += (Math.random() - 0.5) * 0.1;
        entry.mesh.position.z += (Math.random() - 0.5) * 0.1;
        entry.mesh.material.opacity = 0.7;
        entry.mesh.scale.setScalar(0.5 + Math.random() * 0.3);
        entry.mesh.visible = true;
        entry.velocity.set((Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
    }

    function spawnPlasmaTrail(position, color) {
        const entry = plasmaTrails.find(t => !t.active);
        if (!entry) return;
        entry.active = true;
        entry.lifetime = entry.maxLifetime;
        entry.mesh.position.copy(position);
        entry.mesh.material.color.setHex(color);
        entry.mesh.material.opacity = 0.6;
        entry.mesh.scale.setScalar(0.9);
        entry.mesh.visible = true;
    }

    function spawnLiquidSplash(position, color, count = 8) {
        for (let i = 0; i < count; i++) {
            const entry = liquidSplashes.find(s => !s.active);
            if (!entry) break;
            entry.active = true;
            entry.lifetime = 0.35 + Math.random() * 0.25;
            entry.maxLifetime = entry.lifetime;
            entry.mesh.position.copy(position);
            entry.mesh.material.color.setHex(color);
            entry.mesh.material.opacity = 0.95;
            entry.mesh.scale.setScalar(0.6 + Math.random() * 0.6);
            entry.mesh.visible = true;
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 2.5;
            entry.velocity.set(Math.cos(angle) * speed, 1.5 + Math.random() * 1.5, Math.sin(angle) * speed);
        }
    }

    function spawnDropletTrail(position, color) {
        const count = 1 + (Math.random() < 0.35 ? 1 : 0);
        for (let i = 0; i < count; i++) {
            const entry = liquidSplashes.find(s => !s.active);
            if (!entry) return;
            entry.active = true;
            entry.lifetime = 0.45 + Math.random() * 0.2;
            entry.maxLifetime = entry.lifetime;
            entry.mesh.position.copy(position);
            entry.mesh.position.x += (Math.random() - 0.5) * 0.15;
            entry.mesh.position.y += (Math.random() - 0.5) * 0.1;
            entry.mesh.position.z += (Math.random() - 0.5) * 0.15;
            entry.mesh.material.color.setHex(color);
            entry.mesh.material.opacity = 0.9;
            entry.mesh.scale.setScalar(0.35 + Math.random() * 0.3);
            entry.mesh.visible = true;
            entry.velocity.set((Math.random() - 0.5) * 0.8, -0.2 - Math.random() * 0.3, (Math.random() - 0.5) * 0.8);
        }
    }

    function spawnAcidPool(position, radius = 1.2, duration = 2.0, color, dps = 5) {
        const COLORS = C();
        if (color === undefined) color = COLORS.lime;
        const entry = acidPools.find(p => !p.active)
            ?? acidPools.reduce((a, b) => a.lifetime < b.lifetime ? a : b);
        entry.active = true;
        entry.lifetime = duration;
        entry.maxLifetime = duration;
        entry.radius = radius;
        entry.dps = dps;
        entry.tickTimer = 0;
        entry.position.set(position.x, 0.04, position.z);
        entry.mesh.position.copy(entry.position);
        entry.mesh.material.color.setHex(color);
        entry.mesh.material.opacity = 0.55;
        entry.mesh.scale.setScalar(radius);
        entry.mesh.visible = true;
        return entry;
    }

    function getActiveAcidPools() {
        return acidPools.filter(p => p.active);
    }

    function spawnChainLightning(points, color) {
        const COLORS = C();
        if (color === undefined) color = COLORS.cyan;
        if (!points || points.length < 2) return;
        const entry = chainLightnings.find(c => !c.active);
        if (!entry) return;
        const positions = entry.positions;
        let idx = 0;
        const segmentsPerLink = 6;
        const jitter = 0.35;
        const tmp = new THREE.Vector3();
        const perp1 = new THREE.Vector3();
        const perp2 = new THREE.Vector3();
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            tmp.copy(b).sub(a);
            const len = tmp.length();
            if (len < 0.01) continue;
            tmp.normalize();
            if (Math.abs(tmp.y) < 0.9) perp1.set(-tmp.z, 0, tmp.x).normalize();
            else perp1.set(1, 0, 0);
            perp2.crossVectors(tmp, perp1).normalize();
            let prev = a;
            for (let s = 1; s <= segmentsPerLink; s++) {
                const t = s / segmentsPerLink;
                const midX = a.x + (b.x - a.x) * t;
                const midY = a.y + (b.y - a.y) * t;
                const midZ = a.z + (b.z - a.z) * t;
                const off1 = (Math.random() - 0.5) * jitter;
                const off2 = (Math.random() - 0.5) * jitter;
                const nx = midX + perp1.x * off1 + perp2.x * off2;
                const ny = midY + perp1.y * off1 + perp2.y * off2;
                const nz = midZ + perp1.z * off1 + perp2.z * off2;
                const next = s === segmentsPerLink ? b : { x: nx, y: ny, z: nz };
                if (idx + 6 <= positions.length) {
                    positions[idx++] = prev.x; positions[idx++] = prev.y; positions[idx++] = prev.z;
                    positions[idx++] = next.x; positions[idx++] = next.y; positions[idx++] = next.z;
                }
                prev = next;
                if (s < segmentsPerLink && Math.random() < 0.25 && idx + 6 <= positions.length) {
                    const forkLen = 0.6 + Math.random() * 0.4;
                    const fx = prev.x + perp1.x * forkLen * (Math.random() - 0.5) * 2;
                    const fy = prev.y + perp2.y * forkLen * (Math.random() - 0.5) * 2;
                    const fz = prev.z + perp1.z * forkLen * (Math.random() - 0.5) * 2;
                    positions[idx++] = prev.x; positions[idx++] = prev.y; positions[idx++] = prev.z;
                    positions[idx++] = fx; positions[idx++] = fy; positions[idx++] = fz;
                }
            }
        }
        entry.active = true;
        entry.lifetime = entry.maxLifetime;
        entry.lines.geometry.attributes.position.needsUpdate = true;
        entry.lines.geometry.setDrawRange(0, idx / 3);
        entry.lines.material.color.setHex(color);
        entry.lines.material.opacity = 1.0;
        entry.lines.visible = true;
    }

    function update(dt) {
        popups.forEach(popup => {
            if (!popup.active) return;
            popup.lifetime -= dt;
            if (popup.lifetime <= 0) { popup.active = false; popup.sprite.visible = false; return; }
            const lifeRatio = popup.lifetime / 0.8;
            if (lifeRatio > 0.7) {
                const t = (1 - lifeRatio) / 0.3;
                popup.sprite.scale.set(2 * t, 1 * t, 1);
            } else {
                popup.sprite.material.opacity = lifeRatio / 0.7;
            }
            popup.sprite.position.add(popup.velocity.clone().multiplyScalar(dt));
            popup.velocity.y -= 5 * dt;
            popup.velocity.multiplyScalar(0.95);
        });

        particles.forEach(p => {
            if (!p.active) return;
            p.lifetime -= dt;
            if (p.lifetime <= 0) { p.active = false; p.mesh.visible = false; return; }
            p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
            p.velocity.y -= 10 * dt;
            p.velocity.multiplyScalar(p.drag);
            const scale = (p.lifetime / 0.6) * p.mesh.scale.x;
            p.mesh.scale.setScalar(Math.max(0.1, scale));
        });

        deathSplats.forEach(splat => {
            if (!splat.active) return;
            splat.lifetime -= dt;
            if (splat.lifetime <= 0) { splat.active = false; splat.mesh.visible = false; return; }
            if (splat.lifetime < 2) splat.mesh.material.opacity = (splat.lifetime / 2) * 0.8;
        });

        damageNumbers.forEach(dn => {
            if (!dn.active) return;
            dn.lifetime -= dt;
            if (dn.lifetime <= 0) { dn.active = false; dn.sprite.visible = false; return; }
            dn.sprite.position.add(dn.velocity.clone().multiplyScalar(dt));
            dn.velocity.y -= 4 * dt;
            dn.velocity.multiplyScalar(0.92);
            const lifeRatio = dn.lifetime / dn.maxLifetime;
            dn.sprite.material.opacity = Math.min(1.0, lifeRatio * 2);
        });

        explosions.forEach(ex => {
            if (!ex.active) return;
            ex.lifetime -= dt;
            if (ex.lifetime <= 0) { ex.active = false; ex.group.visible = false; return; }
            const t = 1 - ex.lifetime / ex.maxLifetime;
            const scale = ex.targetRadius * (0.1 + t * 1.1);
            ex.flash.scale.setScalar(scale);
            ex.flash.material.opacity = (1 - t) * 0.9;
            ex.ring.scale.setScalar(scale * 1.3);
            ex.ring.material.opacity = (1 - t) * 0.8;
        });

        smokePuffs.forEach(s => {
            if (!s.active) return;
            s.lifetime -= dt;
            if (s.lifetime <= 0) { s.active = false; s.mesh.visible = false; return; }
            s.mesh.position.add(s.velocity.clone().multiplyScalar(dt));
            s.velocity.multiplyScalar(0.96);
            const t = s.lifetime / s.maxLifetime;
            s.mesh.material.opacity = t * 0.7;
            s.mesh.scale.setScalar((1.5 - t) * 0.6);
        });

        plasmaTrails.forEach(p => {
            if (!p.active) return;
            p.lifetime -= dt;
            if (p.lifetime <= 0) { p.active = false; p.mesh.visible = false; return; }
            const t = p.lifetime / p.maxLifetime;
            p.mesh.material.opacity = t * 0.6;
            p.mesh.scale.setScalar(0.3 + t * 0.7);
        });

        liquidSplashes.forEach(d => {
            if (!d.active) return;
            d.lifetime -= dt;
            if (d.lifetime <= 0 || d.mesh.position.y < 0.05) { d.active = false; d.mesh.visible = false; return; }
            d.mesh.position.add(d.velocity.clone().multiplyScalar(dt));
            d.velocity.y -= 14 * dt;
            const t = d.lifetime / d.maxLifetime;
            d.mesh.material.opacity = Math.min(0.95, t * 1.5);
        });

        acidPools.forEach(pool => {
            if (!pool.active) return;
            pool.lifetime -= dt;
            if (pool.lifetime <= 0) { pool.active = false; pool.mesh.visible = false; return; }
            const t = pool.lifetime / pool.maxLifetime;
            const pulse = 0.45 + 0.15 * Math.sin(performance.now() * 0.01);
            pool.mesh.material.opacity = Math.min(pulse, t * pulse * 1.5);
            pool.tickTimer += dt;
        });

        chainLightnings.forEach(c => {
            if (!c.active) return;
            c.lifetime -= dt;
            if (c.lifetime <= 0) { c.active = false; c.lines.visible = false; return; }
            const t = c.lifetime / c.maxLifetime;
            c.lines.material.opacity = t;
        });
    }

    function reset() {
        popups.forEach(p => { p.active = false; p.sprite.visible = false; });
        particles.forEach(p => { p.active = false; p.mesh.visible = false; });
        deathSplats.forEach(s => { s.active = false; s.mesh.visible = false; });
        damageNumbers.forEach(d => { d.active = false; d.sprite.visible = false; });
        explosions.forEach(e => { e.active = false; e.group.visible = false; });
        smokePuffs.forEach(s => { s.active = false; s.mesh.visible = false; });
        plasmaTrails.forEach(p => { p.active = false; p.mesh.visible = false; });
        liquidSplashes.forEach(d => { d.active = false; d.mesh.visible = false; });
        acidPools.forEach(p => { p.active = false; p.mesh.visible = false; });
        chainLightnings.forEach(c => { c.active = false; c.lines.visible = false; });
        screenShake.amplitude = 0;
        screenShake.duration = 0;
        screenShake.elapsed = 0;
        screenShake.offset.set(0, 0, 0);
    }

    window.ZBEffects = {
        init, update, reset,
        spawnPopup, spawnHitParticles, spawnDeathSplat, spawnDamageNumber,
        spawnExplosion, spawnSmokeTrail, spawnPlasmaTrail, spawnLiquidSplash,
        spawnDropletTrail, spawnAcidPool, getActiveAcidPools, spawnChainLightning,
        triggerScreenShake, updateScreenShake, getScreenShakeOffset,
    };
})();
