import { useEffect, useRef } from 'react'
import { WORDMARK_PATH, WORDMARK_SPARKS, WORDMARK_VIEWBOX } from './Logo'

/**
 * Экран кинескопа для интро и аутро. Изображение собирается из символов, как ASCII-арт:
 * плотность символа — яркость точки. По экрану текут полосы света, а название «playos» рисуют сами символы —
 * перед появлением они мельтешат случайными знаками и «застывают» в буквы.
 * Поверх — всё, что делает картинку кинескопом: RGB-триады люминофора, строки развёртки, зерно, мерцание,
 * бегущая полоса, мягкая виньетка, включение линией и выключение в точку.
 *
 * Управляется фазой: intro — появление и уход логотипа вверх; outro — рассыпание и гашение.
 */

export type CrtPhase = 'boot' | 'logo' | 'welcome' | 'show' | 'dissolve' | 'off'

interface Props {
  colors: string[]
  phase: CrtPhase
  /** Волна от центра, мс от монтирования (синхронно со звуком включения) */
  pulseAt?: number
  className?: string
}

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCell;
uniform float uOpen;
uniform float uOff;
uniform float uReveal;
uniform float uDissolve;
uniform float uPulse;
uniform float uDim;
uniform vec4 uRect;
uniform float uGlyphs;
uniform float uRamp;
uniform sampler2D uAtlas;
uniform sampler2D uLogo;
uniform vec3 uC1;
uniform vec3 uC2;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
float band(float x, float w) { return exp(-x * x / (w * w)); }

// Полосы света, как в фоне PlayOS, но спокойнее — на них ложится логотип
vec3 field(vec2 uv, float t) {
  vec2 q = uv * vec2(uRes.x / uRes.y, 1.0);
  vec2 w = vec2(fbm(q * 1.2 + vec2(0.0, t * 0.08)), fbm(q * 1.2 + vec2(5.2, -t * 0.06)));
  q += (w - 0.5) * 1.1;
  float a = q.x * 0.82 + q.y * 0.58 + sin(q.y * 1.9 + t * 0.3) * 0.22;
  float b = q.x * -0.45 + q.y * 0.9 + sin(q.x * 1.5 - t * 0.25) * 0.26;
  float s1 = band(fract(a * 0.55 - t * 0.05) - 0.5, 0.09);
  float s2 = band(fract(b * 0.5 + t * 0.04 + 0.3) - 0.5, 0.13);
  return vec3(0.9, 0.93, 1.0) * s1 * 1.15 + uC1 * s2 * 1.0 + uC2 * 0.16 * fbm(q * 0.8 - t * 0.04);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = frag / uRes;

  // Экран ровный, во всю ширину — без искривления и чёрных полос по краям
  vec2 c = p * 2.0 - 1.0;
  vec2 q = p;

  // Включение: светящаяся линия раскрывается по вертикали. Выключение: сжатие в линию, затем в точку
  float yOpen = uOpen * (1.0 - smoothstep(0.0, 0.55, uOff));
  float xOpen = 1.0 - smoothstep(0.5, 1.0, uOff);
  float dy = abs(q.y - 0.5) * 2.0, dx = abs(q.x - 0.5) * 2.0;
  float visible = step(dy, yOpen + 0.002) * step(dx, xOpen + 0.002);
  float line = band(dy - yOpen, 0.004 + 0.025 * (1.0 - yOpen)) * (1.0 - smoothstep(0.9, 1.0, uOpen) * (1.0 - smoothstep(0.0, 0.3, uOff)))
             * (1.0 - smoothstep(0.0, xOpen + 0.05, dx));

  float t = uTime;
  vec2 px = q * uRes;
  vec2 cell = floor(px / uCell);
  vec2 local = fract(px / uCell);
  vec2 cuv = (cell + 0.5) * uCell / uRes;

  float lumField = dot(field(cuv, t), vec3(0.33));
  vec3 tint = field(cuv, t);

  // Логотип: где он есть, символы плотные. Проявление — фронт слева направо с «мельтешением»
  vec2 luv = (cuv - uRect.xy) / uRect.zw;
  float inLogo = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
  float cover = texture2D(uLogo, vec2(luv.x, 1.0 - luv.y)).r * inLogo;
  float rnd = hash(cell);
  float front = uReveal * 1.35 - 0.2;
  float settled = smoothstep(front, front - 0.12, luv.x + rnd * 0.05);
  float scrambleBand = (1.0 - settled) * smoothstep(front + 0.12, front, luv.x);

  // Рассыпание: символы исчезают в случайном порядке, перед этим мигают
  float gone = step(rnd, uDissolve * 1.1 - 0.05);
  float shaking = step(rnd, uDissolve * 1.1 + 0.12) * (1.0 - gone);

  // Под проявившимися буквами поле гаснет — название читается на любом фоне
  // Поле — только «средние» символы, плотные и яркие остаются названию
  float lum = min(lumField * 1.05, 0.62) * (1.0 - cover * settled * (1.0 - gone) * 0.85) * uDim;
  float logoLum = cover * mix(1.0, 0.0, gone);
  float l = max(lum, logoLum * max(settled, scrambleBand * 0.8));

  // Волна от центра
  vec2 cc = (cuv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float dist = length(cc);
  float wave = uPulse >= 0.0 ? band(dist - 0.05 - uPulse * 1.3, 0.04 + uPulse * 0.04) * exp(-uPulse * 1.5) : 0.0;
  l = max(l, wave * 0.9);

  // Выбор символа: по яркости из «лестницы» плотности, а при мельтешении — любой случайный, каждые 50 мс новый
  float idx = floor(clamp(l, 0.0, 0.999) * uRamp);
  float flick = floor(t * 20.0 + rnd * 7.0);
  float scramble = max(scrambleBand * cover, shaking * cover) + step(0.9985, hash(cell + flick)) * step(0.12, l);
  if (scramble > 0.0) idx = floor(hash(cell + flick * 1.37) * uGlyphs);
  if (l < 0.04 && scramble <= 0.0) idx = 0.0;

  float glyph = texture2D(uAtlas, vec2((idx + clamp(local.x, 0.02, 0.98)) / uGlyphs, 1.0 - local.y)).r;

  // Цвет люминофора: серебро с оттенком полос, логотип — чистый белый
  vec3 phosphor = mix(vec3(0.82, 0.88, 1.0), normalize(tint + 0.0001) * 1.2, 0.35);
  phosphor = mix(phosphor, vec3(1.0), clamp(logoLum * settled, 0.0, 1.0));
  vec3 col = phosphor * glyph * (0.35 + l * 1.25);
  // Свечение под символами — свет «растекается» по стеклу
  col += phosphor * l * 0.09;

  // Кинескоп: RGB-триады по пикселям, строки развёртки, бегущая полоса, мерцание, зерно
  float sub = mod(frag.x, 3.0);
  vec3 triad = sub < 1.0 ? vec3(1.0, 0.45, 0.45) : sub < 2.0 ? vec3(0.45, 1.0, 0.45) : vec3(0.45, 0.45, 1.0);
  col *= mix(vec3(1.0), triad * 1.35, 0.5);
  col *= 0.78 + 0.22 * sin(frag.y * 3.14159 * 0.6667);
  col *= 1.0 + 0.1 * band(fract(q.y * 0.6 - t * 0.12) - 0.5, 0.04);
  col *= 0.965 + 0.035 * sin(t * 61.0);
  col += (hash(frag + fract(t * 7.3) * 100.0) - 0.5) * 0.055;

  // Лёгкая виньетка, чтобы края не спорили с центром
  col *= 1.0 - 0.45 * smoothstep(0.7, 1.45, length(c * vec2(0.9, 1.0)));

  col = col * visible + vec3(0.9, 0.95, 1.0) * line * 1.8;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`

// «Лестница» плотности: от пустоты к самому плотному символу; дальше — знаки для мельтешения
const RAMP = ' .,:;-~=+*o#%@'
const EXTRA = '01ABCDEFXYZ$&?/\\<>[]{}()!^'

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.24, 0.55, 1]
}
const lift = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const k = Math.min(3, 1 / Math.max(r, g, b, 0.001))
  return [r * k, g * k, b * k]
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
  return s
}

function texture(gl: WebGLRenderingContext, src: HTMLCanvasElement) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** Атлас символов: все знаки в одну строку, белым по чёрному */
function atlas(cw: number, ch: number) {
  const chars = RAMP + EXTRA
  const cv = document.createElement('canvas')
  cv.width = cw * chars.length
  cv.height = ch
  const g = cv.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, cv.width, cv.height)
  g.fillStyle = '#fff'
  g.font = `700 ${Math.round(ch * 0.78)}px 'Cascadia Mono', Consolas, 'Courier New', monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let i = 0; i < chars.length; i++) g.fillText(chars[i], i * cw + cw / 2, ch * 0.54)
  return { canvas: cv, count: chars.length }
}

/** Маска названия: контуры «playos» с искрами, белым по чёрному */
function logoMask() {
  const [vx, vy, vw, vh] = WORDMARK_VIEWBOX.split(' ').map(Number)
  const W = 1200
  const H = Math.round((W * vh) / vw)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#fff'
  g.setTransform(W / vw, 0, 0, H / vh, (-vx * W) / vw, (-vy * H) / vh)
  g.fill(new Path2D(WORDMARK_PATH))
  for (const d of WORDMARK_SPARKS) g.fill(new Path2D(d))
  return { canvas: cv, aspect: vw / vh }
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3))
const approach = (cur: number, target: number, dt: number, speed: number) => cur + (target - cur) * (1 - Math.exp(-dt * speed))

export function CrtScreen({ colors, phase, pulseAt = -1, className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (!gl) {
      canvas.classList.add('is-fallback')
      return
    }
    const prog = gl.createProgram()!
    try {
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
    } catch (e) {
      console.warn('[CrtScreen]', e)
      canvas.classList.add('is-fallback')
      return
    }
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)

    const tones = [...colors, '#3d8bff', '#8a5cff'].slice(0, 2).map((c) => lift(rgb(c)))
    gl.uniform3fv(u('uC1'), tones[0])
    gl.uniform3fv(u('uC2'), tones[1])

    const logo = logoMask()
    let atlasTex: WebGLTexture | null = null
    gl.activeTexture(gl.TEXTURE1)
    texture(gl, logo.canvas)
    gl.uniform1i(u('uLogo'), 1)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(u('uRes'), canvas.width, canvas.height)
      // Символ ≈ 9×16 px на экране 1080p
      const cw = Math.max(6, Math.round((canvas.height / 1080) * 9))
      const ch = Math.round(cw * 1.8)
      gl.uniform2f(u('uCell'), cw, ch)
      const a = atlas(cw * 2, ch * 2)
      gl.activeTexture(gl.TEXTURE0)
      if (atlasTex) gl.deleteTexture(atlasTex)
      atlasTex = texture(gl, a.canvas)
      gl.uniform1i(u('uAtlas'), 0)
      gl.uniform1f(u('uGlyphs'), a.count)
      gl.uniform1f(u('uRamp'), RAMP.length)
    }
    resize()
    window.addEventListener('resize', resize)

    const loc2 = {
      time: u('uTime'), open: u('uOpen'), off: u('uOff'), reveal: u('uReveal'), dissolve: u('uDissolve'),
      pulse: u('uPulse'), dim: u('uDim'), rect: u('uRect')
    }
    const start = performance.now()
    let last = start
    const t0 = 40 + Math.random() * 30
    // Текущие значения плавно догоняют цели фазы
    const s = { open: 0, off: 0, reveal: 0, dissolve: 0, dim: 1, y: 0.5, scale: 1 }
    const isOutro = phaseRef.current === 'show' || phaseRef.current === 'dissolve' || phaseRef.current === 'off'
    if (isOutro) Object.assign(s, { open: 1, reveal: 1 })
    let raf = 0
    const frame = (now: number) => {
      const ms = now - start
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const ph = phaseRef.current
      if (!isOutro) {
        // Интро: включение 80–720 мс, проявление названия 650–1550 мс
        s.open = reduce ? 1 : ease((ms - 80) / 640)
        s.reveal = reduce ? 1 : ease((ms - 650) / 900)
      }
      const welcome = ph === 'welcome'
      s.y = approach(s.y, welcome ? 0.77 : 0.5, dt, 5)
      s.scale = approach(s.scale, welcome ? 0.7 : 1, dt, 5)
      s.dim = approach(s.dim, welcome || ph === 'dissolve' || ph === 'off' ? 0.5 : 1, dt, 3)
      s.dissolve = ph === 'dissolve' || ph === 'off' ? Math.min(1, s.dissolve + dt / 0.75) : s.dissolve
      s.off = ph === 'off' ? Math.min(1, s.off + dt / 0.55) : s.off

      const aspect = canvas.width / canvas.height
      const w = 0.5 * s.scale
      const h = (w * aspect) / logo.aspect
      gl.uniform4f(loc2.rect, 0.5 - w / 2, s.y - h / 2, w, h)
      gl.uniform1f(loc2.time, t0 + (reduce ? 0 : ms / 1000))
      gl.uniform1f(loc2.open, Math.max(0.0001, s.open))
      gl.uniform1f(loc2.off, s.off)
      gl.uniform1f(loc2.reveal, s.reveal)
      gl.uniform1f(loc2.dissolve, s.dissolve)
      gl.uniform1f(loc2.dim, s.dim)
      gl.uniform1f(loc2.pulse, pulseAt >= 0 && ms >= pulseAt && !reduce ? (ms - pulseAt) / 1000 : -1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={ref} className={`crt-screen ${className}`} aria-hidden />
}
