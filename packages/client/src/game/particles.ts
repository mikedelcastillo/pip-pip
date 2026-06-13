// Pure particle + screen-shake simulation. NO Pixi imports — this module is
// rendering-agnostic so it can be unit-tested in a plain Node environment.
// Units: age/lifespan in ms, vx/vy in px/ms.

export type Particle = {
    x: number,
    y: number,
    vx: number,
    vy: number,
    age: number,
    lifespan: number,
    size: number,
    color: number,
    drag: number,
    gravity: number,
}

export class ParticleSystem {
    private pool: Particle[] = []
    private live: Particle[] = []

    private acquire(): Particle {
        return this.pool.pop() ?? {} as Particle
    }

    emit(particles: Particle[]){
        // Cap runaway emission so a burst-heavy frame can't balloon the live set.
        if(this.live.length > 500) return
        for(const p of particles){
            this.live.push(p)
        }
    }

    update(dtMs: number){
        for(let i = this.live.length - 1; i >= 0; i--){
            const p = this.live[i]
            const f = Math.pow(1 - p.drag, dtMs)
            p.vx *= f
            p.vy *= f
            p.vy += p.gravity * dtMs
            p.x += p.vx * dtMs
            p.y += p.vy * dtMs
            p.age += dtMs

            if(p.age >= p.lifespan){
                this.live.splice(i, 1)
                this.pool.push(p)
            }
        }
    }

    forEach(cb: (p: Particle) => void){
        for(const p of this.live){
            cb(p)
        }
    }

    get liveCount(){
        return this.live.length
    }
}

function rand(min: number, max: number){
    return min + Math.random() * (max - min)
}

function clamp(n: number, min: number, max: number){
    return Math.min(max, Math.max(min, n))
}

export function emitExplosion(system: ParticleSystem, x: number, y: number, count: number){
    const colors = [0xFF6030, 0xFF9900, 0xFFCC00, 0xFFFFAA]
    const particles: Particle[] = []
    for(let i = 0; i < count; i++){
        const angle = Math.random() * Math.PI * 2
        const speed = rand(1.5, 6.0)
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: 0,
            lifespan: rand(400, 800),
            size: rand(4, 10),
            color: colors[Math.floor(Math.random() * colors.length)],
            drag: 0.004,
            gravity: 0,
        })
    }
    system.emit(particles)
}

export function emitSparks(system: ParticleSystem, x: number, y: number){
    const particles: Particle[] = []
    for(let i = 0; i < 6; i++){
        const angle = Math.random() * Math.PI * 2
        const speed = rand(2.0, 4.5)
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: 0,
            lifespan: rand(150, 300),
            size: rand(2, 4),
            color: i % 2 === 0 ? 0xFFFFFF : 0xE6AE10,
            drag: 0.006,
            gravity: 0,
        })
    }
    system.emit(particles)
}

export function emitThruster(system: ParticleSystem, x: number, y: number, shipAngle: number, speed: number){
    const count = clamp(Math.floor(speed * 0.15), 0, 3)
    const particles: Particle[] = []
    for(let i = 0; i < count; i++){
        // Fire opposite the ship's heading, within a small cone.
        const angle = shipAngle + Math.PI + rand(-0.4, 0.4)
        const pSpeed = rand(0.3, 0.8)
        particles.push({
            x, y,
            vx: Math.cos(angle) * pSpeed,
            vy: Math.sin(angle) * pSpeed,
            age: 0,
            lifespan: rand(80, 200),
            size: rand(2, 5),
            color: 0x7B4FBF,
            drag: 0.008,
            gravity: 0,
        })
    }
    system.emit(particles)
}

export function emitMuzzleFlash(system: ParticleSystem, x: number, y: number, rotation: number){
    const particles: Particle[] = []
    for(let i = 0; i < 4; i++){
        const angle = rotation + rand(-0.6, 0.6)
        const speed = rand(1.0, 2.0)
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: 0,
            lifespan: rand(80, 140),
            size: rand(2, 4),
            color: 0xFFFFFF,
            drag: 0.01,
            gravity: 0,
        })
    }
    system.emit(particles)
}

export type ShakeState = {
    intensity: number,
    elapsed: number,
    duration: number,
}

export function triggerShake(intensity: number, duration: number): ShakeState {
    return { intensity, elapsed: 0, duration }
}

export function computeShake(state: ShakeState, dtMs: number): { dx: number, dy: number } {
    state.elapsed += dtMs
    const decay = Math.max(0, 1 - state.elapsed / state.duration)
    const amp = state.intensity * decay * decay
    const a = Math.random() * Math.PI * 2
    return { dx: Math.cos(a) * amp, dy: Math.sin(a) * amp }
}

export function mergeShake(current: ShakeState, incoming: ShakeState): ShakeState {
    const currentEffective = current.intensity * Math.max(0, 1 - current.elapsed / current.duration)
    return incoming.intensity >= currentEffective ? incoming : current
}
