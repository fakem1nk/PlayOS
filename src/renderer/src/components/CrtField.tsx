import { useEffect, useRef } from 'react'

/**
 * Фон «CRT в 4K»: текучие светящиеся полосы в цветах игр, выведенные сеткой чётких круглых точек,
 * как на светодиодном экране вблизи. Каждая точка — свой «пиксель» с размытым ореолом, яркие точки крупнее.
 * Всё считает видеокарта (WebGL), поэтому плавно и на 4K. Без WebGL — обычный градиент из CSS.
 *
 * openAt / openMs — «включение кинескопа»: светящаяся линия по центру раскрывается на весь экран.
 * pulseAt — момент волны от центра (синхронно со звуком включения).
 */

interface Props {
  colors: string[]
  /** Когда начать включение, мс от монтирования */
  openAt?: number
  openMs?: number
  /** Волна от центра, мс от монтирования */
  pulseAt?: number
  /** Общая яркость 0…1 */
  intensity?: number
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
uniform float uCell;
uniform float uOpen;
uniform float uPulse;
uniform float uIntensity;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;

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

// Мягкий светящийся «луч»: яркий гребень, плавно гаснущий в стороны
float band(float x, float width) { return exp(-x * x / (width * width)); }

vec3 field(vec2 uv, float t) {
  vec2 q = uv * vec2(uRes.x / uRes.y, 1.0);
  // Медленное завихрение пространства — полосы изгибаются, как свет на мятой ткани
  vec2 w = vec2(fbm(q * 1.2 + vec2(0.0, t * 0.09)), fbm(q * 1.2 + vec2(5.2, -t * 0.07)));
  q += (w - 0.5) * 1.1;

  float a = q.x * 0.82 + q.y * 0.58 + sin(q.y * 1.9 + t * 0.33) * 0.22;
  float b = q.x * -0.45 + q.y * 0.9 + sin(q.x * 1.5 - t * 0.27) * 0.26;

  // Три семейства полос: серебристые, в цвет первой игры и в цвет второй; между ними — темнота
  float s1 = band(fract(a * 0.55 - t * 0.06) - 0.5, 0.085);
  float s2 = band(fract(b * 0.5 + t * 0.05 + 0.3) - 0.5, 0.13);
  float s3 = band(fract((a - b) * 0.42 - t * 0.04 + 0.6) - 0.5, 0.16);

  vec3 silver = vec3(0.92, 0.95, 1.0);
  vec3 col = silver * s1 * 1.5 + uC1 * s2 * 1.5 + uC2 * s3 * 1.25;
  // Там, где полосы пересекаются, свет смешивается в белое — как блик на стекле
  col += silver * s1 * (s2 + s3) * 0.8;
  // Глубина: цвет третьей игры тлеет в тенях
  col += uC3 * 0.12 * fbm(q * 0.7 - t * 0.05);
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cell = floor(frag / uCell);
  vec2 center = (cell + 0.5) * uCell;
  vec2 uv = center / uRes;
  float t = uTime;

  vec3 col = field(uv, t);

  // Волна от центра в момент включения
  vec2 c = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float dist = length(c);
  float wave = uPulse >= 0.0 ? band(dist - 0.06 - uPulse * 1.3, 0.035 + uPulse * 0.04) * exp(-uPulse * 1.4) : 0.0;
  col += vec3(0.85, 0.9, 1.0) * wave * 1.1;

  // Дыхание и виньетка
  col *= (0.88 + 0.12 * sin(t * 1.15)) * uIntensity;
  col *= 1.0 - smoothstep(0.45, 1.05, dist);

  // Включение кинескопа: видна только полоса |y| < uOpen, по её краю — яркая линия
  float y = abs(uv.y - 0.5) * 2.0;
  float open = smoothstep(uOpen + 0.004, uOpen - 0.004, y);
  float edge = band(y - uOpen, 0.006 + 0.02 * (1.0 - uOpen)) * (1.0 - smoothstep(0.85, 1.0, uOpen));
  float lineX = 1.0 - smoothstep(0.0, 0.5 + uOpen, abs(uv.x - 0.5) * 2.0 * (1.0 - uOpen * 0.6));
  col = col * open + vec3(0.9, 0.95, 1.0) * edge * lineX * 1.6;

  // Мягкий тон-маппинг: яркие полосы не выгорают в сплошное белое
  col = col / (1.0 + col * 0.32);
  float lum = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

  // Точка: радиус растёт с яркостью, но между точками всегда остаётся тёмный зазор.
  // Край ровно в один пиксель — точка чёткая на любом разрешении
  vec2 local = (frag - center) / uCell;
  float d = length(local);
  float r = mix(0.12, 0.41, pow(lum, 0.6));
  float aa = 0.9 / uCell;
  float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
  float halo = exp(-d * d * 16.0) * 0.14;

  vec3 lit = col * 1.25 * (dotMask + halo);
  // Центр ярких точек светлее края — как у настоящего люминофора
  lit += vec3(1.0) * dotMask * exp(-d * d * 30.0) * smoothstep(0.45, 0.95, lum) * 0.3;
  gl_FragColor = vec4(lit, 1.0);
}
`

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.24, 0.55, 1]
}

/** Цвета обложек бывают тусклыми — приподнимаем яркость, чтобы полосы светились */
function lift([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b, 0.001)
  const k = Math.min(3, 1 / max)
  // И насыщенность: серые обложки не должны давать серый свет
  const avg = (r + g + b) / 3
  const sat = 1.35
  return [r, g, b].map((c) => Math.max(0, avg + (c - avg) * sat) * k) as [number, number, number]
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
  return s
}

export function CrtField({ colors, openAt = 0, openMs = 700, pulseAt = -1, intensity = 1, className = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ intensity })
  live.current.intensity = intensity

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
      console.warn('[CrtField]', e)
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
    const uRes = u('uRes'), uTime = u('uTime'), uCell = u('uCell'), uOpen = u('uOpen'), uPulse = u('uPulse'), uInt = u('uIntensity')
    const tones = [...colors, '#3d8bff', '#2a3f9e', '#0b1a44'].slice(0, 3).map((c) => lift(rgb(c)))
    gl.uniform3fv(u('uC1'), tones[0])
    gl.uniform3fv(u('uC2'), tones[1])
    gl.uniform3fv(u('uC3'), tones[2])

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(canvas.clientWidth * dpr)
      canvas.height = Math.round(canvas.clientHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      // Шаг сетки ≈ 7 px на экране 1080p, на 4K — столько же точек, но каждая чётче
      gl.uniform1f(uCell, Math.max(5, (canvas.height / 1080) * 7.4))
    }
    resize()
    window.addEventListener('resize', resize)

    const start = performance.now()
    // Время поля идёт с «середины», чтобы с первого кадра полосы были уже развитыми
    const t0 = 40 + Math.random() * 30
    let raf = 0
    const frame = (now: number) => {
      const ms = now - start
      const open = reduce ? 1 : Math.min(1, Math.max(0, (ms - openAt) / openMs))
      // Раскрытие с плавным торможением, как разгон электронного луча
      const eased = open === 1 ? 1 : 1 - Math.pow(1 - open, 3)
      gl.uniform1f(uOpen, Math.max(0.0001, eased))
      gl.uniform1f(uTime, t0 + (reduce ? 0 : ms / 1000))
      gl.uniform1f(uPulse, pulseAt >= 0 && ms >= pulseAt && !reduce ? (ms - pulseAt) / 1000 : -1)
      gl.uniform1f(uInt, live.current.intensity)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    // Цвета и тайминги берём один раз при появлении
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={ref} className={`crt-field ${className}`} aria-hidden />
}
