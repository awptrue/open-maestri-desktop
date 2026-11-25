/**
 * Gera resources/icon.png (512x512, RGBA) sem dependencia externa.
 *
 * Desenho: quadrado arredondado escuro, chevron e barra do prompt em branco,
 * e uma corda ambar pendurada embaixo — a mesma metafora das conexoes do canvas.
 *
 * Renderiza em escala 2x e reduz por media de 4 amostras, que e o
 * anti-aliasing barato e suficiente para um icone chapado.
 */

const { deflateSync } = require('node:zlib')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 512
const SS = 2
const W = SIZE * SS

const canvas = new Float64Array(W * W * 4) // RGBA linear 0..1

function blend(x, y, rgba, coverage) {
  if (x < 0 || y < 0 || x >= W || y >= W || coverage <= 0) return
  const a = rgba[3] * Math.min(1, coverage)
  if (a <= 0) return
  const i = (y * W + x) * 4
  const dstA = canvas[i + 3]
  const outA = a + dstA * (1 - a)
  if (outA <= 0) return
  for (let c = 0; c < 3; c++) {
    const src = rgba[c]
    canvas[i + c] = (src * a + canvas[i + c] * dstA * (1 - a)) / outA
  }
  canvas[i + 3] = outA
}

/** SDF de retangulo arredondado; negativo dentro. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

/** SDF de segmento de reta. */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
  return Math.hypot(wx - vx * t, wy - vy * t)
}

function fillShape(test, rgba) {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const d = test(x + 0.5, y + 0.5)
      blend(x, y, rgba, Math.min(1, Math.max(0, 0.5 - d)))
    }
  }
}

const s = (v) => v * SS

// Fundo: quadrado arredondado com leve gradiente vertical.
const BG_TOP = [0.075, 0.082, 0.11, 1]
const BG_BOTTOM = [0.045, 0.05, 0.07, 1]
for (let y = 0; y < W; y++) {
  const t = y / (W - 1)
  const rgb = [
    BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
    1,
  ]
  const d = sdRoundRect(W / 2, y + 0.5, W / 2, W / 2, s(248), s(248), s(104))
  for (let x = 0; x < W; x++) {
    const dx = sdRoundRect(x + 0.5, y + 0.5, W / 2, W / 2, s(248), s(248), s(104))
    blend(x, y, rgb, Math.min(1, Math.max(0, 0.5 - dx)))
  }
  void d
}

// Borda interna sutil, para o icone nao sumir em fundo escuro.
fillShape((x, y) => Math.abs(sdRoundRect(x, y, W / 2, W / 2, s(248), s(248), s(104)) + s(3)) - s(1.2), [
  0.24, 0.26, 0.33, 0.9,
])

// Corda ambar: parabola amostrada, desenhada como cadeia de segmentos.
const ROPE = [0.88, 0.66, 0.24, 1]
const ropePoints = []
for (let i = 0; i <= 64; i++) {
  const t = i / 64
  // Bezier quadratica (112,378) -> (256,452) -> (400,378) em coordenadas 512.
  const x = (1 - t) * (1 - t) * s(112) + 2 * (1 - t) * t * s(256) + t * t * s(400)
  const y = (1 - t) * (1 - t) * s(378) + 2 * (1 - t) * t * s(452) + t * t * s(378)
  ropePoints.push([x, y])
}
for (let i = 0; i < ropePoints.length - 1; i++) {
  const [ax, ay] = ropePoints[i]
  const [bx, by] = ropePoints[i + 1]
  fillShape((x, y) => sdSegment(x, y, ax, ay, bx, by) - s(6), ROPE)
}

// Pontas da corda: os dois "nos" ligados por ela.
fillShape((x, y) => Math.hypot(x - s(112), y - s(378)) - s(15), ROPE)
fillShape((x, y) => Math.hypot(x - s(400), y - s(378)) - s(15), ROPE)

// Chevron ">" e barra "_", brancos, pontas arredondadas.
const GLYPH = [0.93, 0.94, 0.97, 1]
const STROKE = s(13)
fillShape((x, y) => sdSegment(x, y, s(186), s(150), s(292), s(232)) - STROKE, GLYPH)
fillShape((x, y) => sdSegment(x, y, s(292), s(232), s(186), s(314)) - STROKE, GLYPH)
fillShape((x, y) => sdSegment(x, y, s(322), s(312), s(398), s(312)) - STROKE, GLYPH)

// Reducao por media de bloco SS x SS.
const out = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * W + (x * SS + dx)) * 4
        r += canvas[i]
        g += canvas[i + 1]
        b += canvas[i + 2]
        a += canvas[i + 3]
      }
    }
    const n = SS * SS
    const o = (y * SIZE + x) * 4
    out[o] = Math.round((r / n) * 255)
    out[o + 1] = Math.round((g / n) * 255)
    out[o + 2] = Math.round((b / n) * 255)
    out[o + 3] = Math.round((a / n) * 255)
  }
}

// --- PNG: IHDR + IDAT (zlib) + IEND ---------------------------------------
const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}

function crc32(buffer) {
  let c = ~0
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bits por canal
ihdr[9] = 6 // RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

// Cada scanline comeca com o byte de filtro 0 (None).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const dir = join(__dirname, '..', 'resources')
mkdirSync(dir, { recursive: true })
const target = join(dir, 'icon.png')
writeFileSync(target, png)
console.log(`icon.png ${SIZE}x${SIZE} ${png.length} bytes -> ${target}`)
