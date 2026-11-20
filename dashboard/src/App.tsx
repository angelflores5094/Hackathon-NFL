import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface PlayMeta {
  gameId: number | string
  playId: number
  playDescription?: string
  possessionTeam?: string
  defensiveTeam?: string
  down?: number
  yardsToGo?: number
  playResult?: number
  passResult?: string
  offenseFormation?: string
  pff_passCoverage?: string
  quarter?: number
  gameClock?: string
}

interface PlayerDot {
  nflId: number | null
  name: string
  jersey: number | null
  position: string
  team: string
  x: number
  y: number
  s: number
  a: number
  o: number
  dir: number
  frameId: number
  event: string | null
}

interface FramePayload {
  gameId: string
  playId: number
  minFrame: number
  maxFrame: number
  field: { x: number; y: number }
  players: PlayerDot[]
  events: { frameId: number; event: string }[]
}

interface SBI {
  metric: string
  definition: string
  target_id?: number
  target_name: string
  defender_at_burst: string | null
  sep_at_snap: number | null
  sep_at_1_5s: number | null
  sep_at_catch: number | null
  delta_separation: number
  speed_advantage: number
  sbi: number
  snap_frame: number
  burst_frame: number
  catch_frame: number | null
}

interface TargetOption {
  nflId: number
  name: string
  position: string
  jersey: number | null
}

const OFF_COLOR = '#DC2626'
const DEF_COLOR = '#2563EB'
const BALL_COLOR = '#F59E0B'
const TARGET_RING = '#FBBF24'
const GRASS_A = '#3CB043'
const GRASS_B = '#2E8B3A'
const GRASS_END = '#2A9B3C'
const LINE_WHITE = '#FFFFFF'
const POST_COLOR = '#D4A574'
const DIRT_BORDER = '#6B3E26'

function sbiLabel(score: number): { text: string; color: string; hint: string } {
  if (score >= 5) return { text: 'Dominio', color: 'text-emerald-400', hint: 'El receptor abrió la ruta con claridad' }
  if (score >= 2) return { text: 'Útil', color: 'text-sky-400', hint: 'Separación aprovechable para el pase' }
  if (score >= 0) return { text: 'Marginal', color: 'text-amber-400', hint: 'Poco espacio; el defensor estuvo cerca' }
  return { text: 'Cubierta', color: 'text-rose-400', hint: 'El defensor controló la ruta' }
}

function eventLabelEs(ev: string | null | undefined): string | null {
  if (!ev || ev === 'None') return null
  const map: Record<string, string> = {
    ball_snap: 'Snap',
    pass_forward: 'Pase lanzado',
    pass_arrived: 'Llega el balón',
    pass_outcome_caught: 'Recepción',
    pass_outcome_incomplete: 'Incompleto',
    tackle: 'Tacleada',
    first_contact: 'Primer contacto',
    out_of_bounds: 'Fuera de banda',
  }
  return map[ev] ?? ev.replace(/_/g, ' ')
}

const TEAM_NAMES: Record<string, string> = {
  TB: 'Tampa Bay',
  DAL: 'Dallas',
  KC: 'Kansas City',
  BAL: 'Baltimore',
  ATL: 'Atlanta',
  PHI: 'Filadelfia',
  BUF: 'Buffalo',
  PIT: 'Pittsburgh',
  CAR: 'Carolina',
  NYJ: 'NY Jets',
  CIN: 'Cincinnati',
  MIN: 'Minnesota',
  DET: 'Detroit',
  SF: 'San Francisco',
  LAR: 'LA Rams',
  SEA: 'Seattle',
  GB: 'Green Bay',
  CHI: 'Chicago',
  NO: 'New Orleans',
  NE: 'Nueva Inglaterra',
  MIA: 'Miami',
  NYG: 'NY Giants',
  WAS: 'Washington',
  DEN: 'Denver',
  LV: 'Las Vegas',
  LAC: 'LA Chargers',
  IND: 'Indianapolis',
  TEN: 'Tennessee',
  JAX: 'Jacksonville',
  HOU: 'Houston',
  CLE: 'Cleveland',
  ARI: 'Arizona',
}

function teamName(abbr?: string | null): string {
  if (!abbr) return ''
  return TEAM_NAMES[abbr] || abbr
}

function ordinalDown(d?: number | null): string {
  if (d == null) return ''
  if (d === 1) return '1ª'
  if (d === 2) return '2ª'
  if (d === 3) return '3ª'
  if (d === 4) return '4ª'
  return `${d}ª`
}

function passResultLabel(r?: string | null): string {
  if (!r) return ''
  if (r === 'C') return 'completo'
  if (r === 'I') return 'incompleto'
  if (r === 'IN') return 'intercepción'
  if (r === 'S') return 'sack'
  return r
}

function quarterTitle(q: number): string {
  if (q === 1) return 'Primer cuarto'
  if (q === 2) return 'Segundo cuarto'
  if (q === 3) return 'Tercer cuarto'
  if (q === 4) return 'Cuarto cuarto'
  if (q === 5) return 'Tiempo extra'
  return `Cuarto ${q}`
}

/** Etiqueta natural para el menú de jugadas */
function playLabel(p: PlayMeta): string {
  const clock = p.gameClock ? `${p.gameClock}` : ''
  const team = teamName(p.possessionTeam) || p.possessionTeam || ''
  const down =
    p.down != null && p.yardsToGo != null
      ? `${ordinalDown(p.down)} y ${p.yardsToGo}`
      : ''
  const result = passResultLabel(p.passResult)
  const parts = [clock, team, down, result].filter(Boolean)
  return parts.join(' · ') || p.playDescription?.slice(0, 70) || `Jugada ${p.playId}`
}

function GoalPost({ x, y, h, side }: { x: number; y: number; h: number; side: 'left' | 'right' }) {
  const postH = h * 0.42
  const crossW = h * 0.16
  const upright = h * 0.22
  const baseY = y + h / 2
  const dir = side === 'left' ? 1 : -1
  const stemX = x + dir * 4
  return (
    <g stroke={POST_COLOR} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line x1={stemX} y1={baseY - postH / 2} x2={stemX} y2={baseY + postH / 2} />
      <line x1={stemX} y1={baseY} x2={stemX + dir * crossW} y2={baseY} />
      <line x1={stemX + dir * crossW} y1={baseY - upright} x2={stemX + dir * crossW} y2={baseY + upright} />
    </g>
  )
}

function Field({
  players,
  field,
  targetId,
  offenseTeam,
}: {
  players: PlayerDot[]
  field: { x: number; y: number }
  targetId: number | null
  offenseTeam: string | null
}) {
  // Proporción real ~120 × 53.3
  const w = 960
  const h = 420
  const margin = 18
  const pad = margin + 8
  const innerW = w - 2 * pad
  const innerH = h - 2 * pad
  const scaleX = (x: number) => pad + (x / field.x) * innerW
  const scaleY = (y: number) => pad + (1 - y / field.y) * innerH
  const yardToPx = innerW / field.x
  const playerR = Math.max(5, Math.min(7.5, yardToPx * 0.75))
  const ballR = playerR * 0.5
  const targetR = playerR * 1.2

  // Rayas cada 5 yardas (estilo ilustración)
  const stripes: number[] = []
  for (let yd = 0; yd < 120; yd += 5) stripes.push(yd)

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-auto w-full rounded-2xl shadow-lg"
      role="img"
      aria-label="Campo de fútbol americano"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Marco exterior tipo pista / dirt */}
      <rect x={0} y={0} width={w} height={h} fill={DIRT_BORDER} rx={14} />
      {/* Banda verde exterior */}
      <rect x={margin * 0.4} y={margin * 0.4} width={w - margin * 0.8} height={h - margin * 0.8} fill={GRASS_B} rx={10} />

      {/* Césped a rayas verticales (como la referencia) */}
      {stripes.map((yd, i) => (
        <rect
          key={`s-${yd}`}
          x={scaleX(yd)}
          y={pad}
          width={Math.min(5 * yardToPx, scaleX(120) - scaleX(yd))}
          height={innerH}
          fill={i % 2 === 0 ? GRASS_A : GRASS_B}
        />
      ))}

      {/* End zones un tono más vivo */}
      <rect x={pad} y={pad} width={10 * yardToPx} height={innerH} fill={GRASS_END} opacity={0.95} />
      <rect x={scaleX(110)} y={pad} width={10 * yardToPx} height={innerH} fill={GRASS_END} opacity={0.95} />

      {/* Líneas de yarda cada 5 */}
      {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110].map((yd) => (
        <line
          key={`yl-${yd}`}
          x1={scaleX(yd)}
          y1={pad}
          x2={scaleX(yd)}
          y2={h - pad}
          stroke={LINE_WHITE}
          strokeWidth={yd === 60 ? 3 : yd === 10 || yd === 110 ? 2.5 : 1.4}
          opacity={yd === 60 ? 1 : 0.92}
        />
      ))}

      {/* Goal lines reforzadas */}
      <line x1={scaleX(10)} y1={pad} x2={scaleX(10)} y2={h - pad} stroke={LINE_WHITE} strokeWidth={3} />
      <line x1={scaleX(110)} y1={pad} x2={scaleX(110)} y2={h - pad} stroke={LINE_WHITE} strokeWidth={3} />

      {/* Sidelines y end lines */}
      <rect
        x={pad}
        y={pad}
        width={innerW}
        height={innerH}
        fill="none"
        stroke={LINE_WHITE}
        strokeWidth={3}
        rx={1}
      />

      {/* Hash marks superiores e inferiores (ticks) */}
      {Array.from({ length: 99 }, (_, k) => k + 11).map((yd) => (
        <g key={`hash-${yd}`}>
          <line
            x1={scaleX(yd)}
            y1={pad}
            x2={scaleX(yd)}
            y2={pad + 8}
            stroke={LINE_WHITE}
            strokeWidth={1.2}
            opacity={0.9}
          />
          <line
            x1={scaleX(yd)}
            y1={h - pad - 8}
            x2={scaleX(yd)}
            y2={h - pad}
            stroke={LINE_WHITE}
            strokeWidth={1.2}
            opacity={0.9}
          />
        </g>
      ))}

      {/* Hash marks centrales (puntos / ticks) */}
      {[field.y * 0.33, field.y * 0.67].map((hy, i) =>
        Array.from({ length: 99 }, (_, k) => k + 11).map((yd) => (
          <circle
            key={`hc-${i}-${yd}`}
            cx={scaleX(yd)}
            cy={scaleY(hy)}
            r={1.3}
            fill={LINE_WHITE}
            opacity={0.75}
          />
        ))
      )}

      {/* Números de yarda */}
      {[20, 30, 40, 50, 60, 70, 80, 90, 100].map((yd) => {
        const label = yd <= 60 ? yd - 10 : 110 - yd
        return (
          <g key={`num-${yd}`}>
            <text
              x={scaleX(yd)}
              y={pad + 22}
              textAnchor="middle"
              fill={LINE_WHITE}
              fontSize={14}
              fontWeight={800}
              opacity={0.85}
              style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
            >
              {label}
            </text>
            <text
              x={scaleX(yd)}
              y={h - pad - 10}
              textAnchor="middle"
              fill={LINE_WHITE}
              fontSize={14}
              fontWeight={800}
              opacity={0.85}
              style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
            >
              {label}
            </text>
          </g>
        )
      })}

      {/* Porterías */}
      <GoalPost x={pad} y={pad} h={innerH} side="left" />
      <GoalPost x={w - pad} y={pad} h={innerH} side="right" />

      {/* Jugadores */}
      {players.map((p) => {
        const isBall = p.team === 'football' || p.position === 'ball'
        const isTarget = p.nflId != null && p.nflId === targetId
        const isOffense = offenseTeam
          ? p.team === offenseTeam
          : ['QB', 'WR', 'TE', 'RB', 'FB', 'OL', 'C', 'G', 'T'].includes(p.position || '')
        const fill = isBall ? BALL_COLOR : isOffense ? OFF_COLOR : DEF_COLOR
        const r = isBall ? ballR : isTarget ? targetR : playerR
        const cx = scaleX(p.x)
        const cy = scaleY(p.y)
        return (
          <g key={`${p.nflId ?? 'ball'}-${p.frameId}`}>
            {isTarget && (
              <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={TARGET_RING} strokeWidth={2.2} />
            )}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
              stroke="white"
              strokeWidth={1.3}
              opacity={0.96}
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}
            />
            {!isBall && p.jersey != null && (
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                fontSize={Math.max(7, playerR * 0.95)}
                fontWeight={700}
                fill="white"
              >
                {p.jersey}
              </text>
            )}
            {!isBall && p.dir != null && Number.isFinite(p.dir) && (
              <line
                x1={cx}
                y1={cy}
                x2={cx + Math.cos((p.dir * Math.PI) / 180) * (r + 5)}
                y2={cy - Math.sin((p.dir * Math.PI) / 180) * (r + 5)}
                stroke="white"
                strokeWidth={1.3}
                opacity={0.85}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function LegendBar({ offenseTeam }: { offenseTeam: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: OFF_COLOR }} />
        Ataque{offenseTeam ? ` (${teamName(offenseTeam) || offenseTeam})` : ''}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: DEF_COLOR }} />
        Defensa
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BALL_COLOR }} />
        Balón
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-400 bg-transparent" />
        Receptor en análisis
      </span>
    </div>
  )
}

export default function App() {
  const [plays, setPlays] = useState<PlayMeta[]>([])
  const [selected, setSelected] = useState<{ gameId: number | string; playId: number } | null>(null)
  const [allFrames, setAllFrames] = useState<FramePayload | null>(null)
  const [frame, setFrame] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [sbiData, setSbiData] = useState<{
    sbi: SBI
    separation_series: { frameId: number; time: number; separation: number; target_speed: number }[]
    offense_team?: string
    targets?: TargetOption[]
    play?: PlayMeta
  } | null>(null)
  const [targetId, setTargetId] = useState<number | null>(null)
  const [insight, setInsight] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPlay, setLoadingPlay] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<'inicio' | 'jugadas' | 'sbi'>('inicio')
  const [menuOpen, setMenuOpen] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    fetch('api/plays?limit=200')
      .then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar la lista de jugadas')
        return r.json()
      })
      .then((data: PlayMeta[]) => {
        setPlays(data)
        if (data.length) setSelected({ gameId: data[0].gameId, playId: data[0].playId })
      })
      .catch((e) => setError(e.message || 'Error de conexión con el backend'))
      .finally(() => setLoading(false))
  }, [])

  const playsByQuarter = useMemo(() => {
    const map = new Map<number, PlayMeta[]>()
    for (const p of plays) {
      const q = p.quarter ?? 0
      if (!map.has(q)) map.set(q, [])
      map.get(q)!.push(p)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [plays])

  const loadPlay = useCallback(async (gameId: string | number, playId: number) => {
    setLoadingPlay(true)
    setInsight(null)
    setError(null)
    try {
      const framesRes = await fetch(`api/play/${gameId}/${playId}/frames`)
      if (!framesRes.ok) throw new Error('Jugada no encontrada en el tracking')
      const framesData: FramePayload = await framesRes.json()
      setAllFrames(framesData)
      setFrame(framesData.minFrame)

      const sbiRes = await fetch(`api/play/${gameId}/${playId}/sbi`)
      if (!sbiRes.ok) throw new Error('No se pudo calcular el SBI')
      const sbiJson = await sbiRes.json()
      setSbiData(sbiJson)
      setTargetId(sbiJson.sbi?.target_id ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar la jugada')
      setAllFrames(null)
      setSbiData(null)
    } finally {
      setLoadingPlay(false)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    setPlaying(false)
    loadPlay(selected.gameId, selected.playId)
  }, [selected, loadPlay])

  const onTargetChange = (nid: number) => {
    if (!selected) return
    setTargetId(nid)
    setPlaying(false)
    fetch(`api/play/${selected.gameId}/${selected.playId}/sbi?target_id=${nid}`)
      .then((r) => r.json())
      .then((json) => {
        setSbiData(json)
        setTargetId(json.sbi?.target_id ?? nid)
      })
  }

  useEffect(() => {
    if (!playing || !allFrames) return
    timer.current = window.setInterval(() => {
      setFrame((f) => {
        if (f >= allFrames.maxFrame) {
          setPlaying(false)
          return f
        }
        return f + 1
      })
    }, 100)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [playing, allFrames])

  const currentPlayers = useMemo(() => {
    if (!allFrames) return []
    return allFrames.players.filter((p) => p.frameId === frame)
  }, [allFrames, frame])

  const playMeta = sbiData?.play
  const offenseTeam = sbiData?.offense_team ?? playMeta?.possessionTeam ?? null
  const sbi = sbiData?.sbi
  const sbiInfo = sbi && !('error' in sbi) ? sbiLabel(sbi.sbi) : null
  const eventAtFrame = allFrames?.events.find((e) => e.frameId === frame)
  const eventEs = eventLabelEs(eventAtFrame?.event)

  const keyEvents = useMemo(() => {
    if (!allFrames) return []
    const wanted = new Set([
      'ball_snap',
      'pass_forward',
      'pass_arrived',
      'pass_outcome_caught',
      'pass_outcome_incomplete',
    ])
    return allFrames.events.filter((e) => wanted.has(e.event))
  }, [allFrames])

  const askInsight = async () => {
    if (!selected) return
    const res = await fetch('api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_id: Number(selected.gameId),
        play_id: selected.playId,
        target_id: targetId ?? undefined,
      }),
    })
    const data = await res.json()
    setInsight(data.insight)
  }

  const selectPlay = (p: PlayMeta) => {
    setSelected({ gameId: p.gameId, playId: p.playId })
    setSection('inicio')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0b1220] text-slate-400">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <p>Cargando NFL Data…</p>
      </div>
    )
  }

  if (error && !plays.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b1220] px-4 text-center">
        <p className="text-lg text-rose-400">{error}</p>
        <p className="max-w-md text-sm text-slate-500">
          Arranca el backend:{' '}
          <code className="text-slate-400">uvicorn backend.main:app --reload --port 8000</code>
        </p>
      </div>
    )
  }

  const goTo = (id: 'inicio' | 'jugadas' | 'sbi') => {
    setSection(id)
    setMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-[#0b1220] text-slate-100">
      {/* Nav NFL Data + menú desplegable */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[#0d1526]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Menú desplegable — esquina superior izquierda */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#1a2744] px-3 py-2 text-sm font-medium text-slate-100 hover:bg-[#243556]"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="flex flex-col gap-1" aria-hidden>
                  <span className="block h-0.5 w-4 rounded bg-slate-200" />
                  <span className="block h-0.5 w-4 rounded bg-slate-200" />
                  <span className="block h-0.5 w-4 rounded bg-slate-200" />
                </span>
                Menú
                <span className={`text-xs text-slate-400 transition ${menuOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {menuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-black/30"
                    aria-label="Cerrar menú"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#121a2b] shadow-2xl"
                  >
                    {/* Fans */}
                    <div className="border-b border-white/5 px-3 py-2">
                      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                        Para fans
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => goTo('inicio')}
                        className={`flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-white/5 ${
                          section === 'inicio' ? 'bg-white/5' : ''
                        }`}
                      >
                        <span className="text-sm font-medium text-white">Ver el replay</span>
                        <span className="text-xs text-slate-500">Cancha, play y la jugada en vivo</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => goTo('jugadas')}
                        className={`flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-white/5 ${
                          section === 'jugadas' ? 'bg-white/5' : ''
                        }`}
                      >
                        <span className="text-sm font-medium text-white">Elegir una jugada</span>
                        <span className="text-xs text-slate-500">Lista por cuartos, fácil de leer</span>
                      </button>
                    </div>

                    {/* Técnicos */}
                    <div className="px-3 py-2">
                      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                        Para técnicos
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => goTo('sbi')}
                        className={`flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-white/5 ${
                          section === 'sbi' ? 'bg-white/5' : ''
                        }`}
                      >
                        <span className="text-sm font-medium text-white">Análisis SBI</span>
                        <span className="text-xs text-slate-500">Separación, velocidad e insight de ruta</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => goTo('sbi')}
                        className="flex w-full flex-col rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
                      >
                        <span className="text-sm font-medium text-white">Métricas del receptor</span>
                        <span className="text-xs text-slate-500">Δ separación, ventaja de velocidad, catch</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a2744] text-xl shadow-inner">
                🏈
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">NFL Data</h1>
                <p className="text-[11px] text-slate-400">Replay · rutas · Separation Burst Index</p>
              </div>
            </div>
          </div>

          {/* Atajos en desktop */}
          <nav className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => goTo('inicio')}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                section === 'inicio' ? 'font-medium text-rose-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Inicio
            </button>
            <button
              type="button"
              onClick={() => goTo('jugadas')}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                section === 'jugadas' ? 'font-medium text-rose-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Jugadas
            </button>
            <button
              type="button"
              onClick={() => goTo('sbi')}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                section === 'sbi' ? 'font-medium text-rose-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SBI
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* ========== INICIO: cancha + controles ========== */}
        {section === 'inicio' && (
          <>
            <section className="overflow-hidden rounded-2xl border border-white/5 bg-[#121a2b] shadow-xl">
              <div
                className="relative border-b border-white/5 px-5 py-6"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(13,21,38,0.95) 0%, rgba(20,40,30,0.85) 100%)',
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Inicio</p>
                <h2 className="mt-1 text-2xl font-bold">Replay de la jugada</h2>
                <p className="mt-1 max-w-xl text-sm text-slate-400">
                  Mira cada frame del tracking, elige al receptor y entiende si la ruta ganó separación
                  en el primer segundo y medio.
                </p>
              </div>

              <div className="p-4 sm:p-5">
                {(playMeta || offenseTeam) && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {playMeta?.possessionTeam && playMeta?.defensiveTeam && (
                      <span className="rounded-full bg-[#1a2744] px-3 py-1 text-sm font-medium">
                        {teamName(playMeta.possessionTeam) || playMeta.possessionTeam}
                        {' vs '}
                        {teamName(playMeta.defensiveTeam) || playMeta.defensiveTeam}
                      </span>
                    )}
                    {playMeta?.down != null && playMeta?.yardsToGo != null && (
                      <span className="rounded-full bg-[#1a2744] px-3 py-1 text-sm">
                        {ordinalDown(playMeta.down)} y {playMeta.yardsToGo}
                      </span>
                    )}
                    {playMeta?.quarter != null && (
                      <span className="rounded-full bg-[#1a2744] px-3 py-1 text-sm">
                        {quarterTitle(playMeta.quarter)}
                      </span>
                    )}
                    {playMeta?.gameClock && (
                      <span className="rounded-full bg-[#1a2744] px-3 py-1 font-mono text-sm">
                        {playMeta.gameClock}
                      </span>
                    )}
                    {playMeta?.passResult && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          playMeta.passResult === 'C'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {passResultLabel(playMeta.passResult)}
                      </span>
                    )}
                    {loadingPlay && <span className="text-xs text-slate-500">Cargando…</span>}
                  </div>
                )}

                {allFrames ? (
                  <Field
                    players={currentPlayers}
                    field={allFrames.field}
                    targetId={targetId}
                    offenseTeam={offenseTeam}
                  />
                ) : (
                  <div className="flex h-56 items-center justify-center rounded-2xl bg-[#0b1220] text-slate-500">
                    Elige una jugada en la pestaña Jugadas
                  </div>
                )}

                {allFrames && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPlaying(false)
                            setFrame(allFrames.minFrame)
                          }}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                        >
                          ⏮
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlaying((p) => !p)}
                          className="rounded-lg bg-emerald-600 px-5 py-1.5 text-sm font-semibold hover:bg-emerald-500"
                        >
                          {playing ? 'Pausa' : 'Reproducir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPlaying(false)
                            setFrame((f) => Math.min(allFrames.maxFrame, f + 1))
                          }}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
                        >
                          ⏭
                        </button>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-400">
                        {eventEs && (
                          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                            {eventEs}
                          </span>
                        )}
                        <span className="font-mono">
                          Frame {frame}
                          <span className="text-slate-600"> / {allFrames.maxFrame}</span>
                        </span>
                        <span className="font-mono text-slate-500">{((frame - 1) * 0.1).toFixed(1)} s</span>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="range"
                        min={allFrames.minFrame}
                        max={allFrames.maxFrame}
                        value={frame}
                        onChange={(e) => {
                          setPlaying(false)
                          setFrame(Number(e.target.value))
                        }}
                        className="w-full accent-emerald-500"
                        aria-label="Línea de tiempo"
                      />
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
                        {keyEvents.map((ev) => {
                          const pct =
                            ((ev.frameId - allFrames.minFrame) /
                              Math.max(1, allFrames.maxFrame - allFrames.minFrame)) *
                            100
                          return (
                            <span
                              key={`${ev.frameId}-${ev.event}`}
                              className="absolute h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-amber-400"
                              style={{ left: `${pct}%` }}
                              title={eventLabelEs(ev.event) ?? ev.event}
                            />
                          )
                        })}
                      </div>
                    </div>
                    <LegendBar offenseTeam={offenseTeam} />
                  </div>
                )}

                {playMeta?.playDescription && (
                  <p className="mt-4 text-sm leading-relaxed text-slate-400">{playMeta.playDescription}</p>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSection('jugadas')}
                    className="rounded-xl border border-white/10 bg-[#1a2744] px-4 py-2 text-sm font-medium hover:bg-[#243556]"
                  >
                    Ver todas las jugadas
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('sbi')}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
                  >
                    Ir al análisis SBI
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ========== JUGADAS ========== */}
        {section === 'jugadas' && (
          <section className="rounded-2xl border border-white/5 bg-[#121a2b] shadow-xl">
            <div className="border-b border-white/5 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Jugadas</p>
              <h2 className="mt-1 text-2xl font-bold">Elige una jugada del partido</h2>
              <p className="mt-1 text-sm text-slate-400">
                Agrupadas por cuarto, en lenguaje de cancha. Al seleccionar una, vuelves al replay.
              </p>
            </div>
            <div className="space-y-6 p-5">
              {playsByQuarter.map(([q, list]) => (
                <div key={q}>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a2744] text-xs font-bold text-emerald-400">
                      {q || '—'}
                    </span>
                    {q > 0 ? quarterTitle(q) : 'Otras jugadas'}
                    <span className="text-xs font-normal text-slate-500">({list.length})</span>
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((p) => {
                      const active =
                        selected &&
                        String(selected.gameId) === String(p.gameId) &&
                        selected.playId === p.playId
                      return (
                        <button
                          key={`${p.gameId}-${p.playId}`}
                          type="button"
                          onClick={() => selectPlay(p)}
                          className={`rounded-xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-emerald-500/50 bg-emerald-500/10'
                              : 'border-white/5 bg-[#0b1220] hover:border-white/15 hover:bg-[#0f1829]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-slate-100">{playLabel(p)}</span>
                            {p.passResult && (
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                                  p.passResult === 'C'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-rose-500/20 text-rose-300'
                                }`}
                              >
                                {passResultLabel(p.passResult)}
                              </span>
                            )}
                          </div>
                          {p.playDescription && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.playDescription}</p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ========== ANÁLISIS SBI ========== */}
        {section === 'sbi' && (
          <section className="space-y-5">
            <div className="rounded-2xl border border-white/5 bg-[#121a2b] px-5 py-5 shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Análisis SBI</p>
              <h2 className="mt-1 text-2xl font-bold">Separation Burst Index</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Mide cuánta separación gana el receptor en 1.5 s después del snap frente al defensor más
                cercano. Ideal para coaches de WR/DB y para narrar si la ruta “ganó” temprano.
              </p>
            </div>

            {/* Selector de receptor */}
            {sbiData?.targets && sbiData.targets.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-[#121a2b] px-5 py-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-300">Receptor a analizar</h3>
                <div className="flex flex-wrap gap-2">
                  {sbiData.targets.map((t) => {
                    const active = t.nflId === targetId
                    return (
                      <button
                        key={t.nflId}
                        type="button"
                        onClick={() => onTargetChange(t.nflId)}
                        className={`rounded-xl border px-3 py-2 text-sm transition ${
                          active
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                            : 'border-white/10 bg-[#0b1220] text-slate-300 hover:border-white/20'
                        }`}
                      >
                        <span className="font-medium">{t.name}</span>
                        <span className="ml-1.5 text-xs text-slate-500">
                          {t.position}
                          {t.jersey != null ? ` · #${t.jersey}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-[#121a2b] p-5 shadow-xl">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Resultado SBI</h3>
                {sbi && !('error' in sbi) && sbiInfo ? (
                  <>
                    <div className="mt-4 flex items-end gap-3">
                      <p className="text-5xl font-black tabular-nums text-white">{sbi.sbi}</p>
                      <div className="mb-1">
                        <span className={`text-sm font-semibold ${sbiInfo.color}`}>{sbiInfo.text}</span>
                        <p className="text-xs text-slate-500">{sbiInfo.hint}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">
                      <span className="font-semibold text-white">{sbi.target_name}</span>
                      {sbi.defender_at_burst && (
                        <>
                          {' '}
                          frente a <span className="text-slate-200">{sbi.defender_at_burst}</span>
                        </>
                      )}
                    </p>
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wide text-slate-500">
                        <span>Cubierta</span>
                        <span>Útil</span>
                        <span>Dominio</span>
                      </div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-[#0b1220]">
                        <div className="absolute inset-0 bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 opacity-80" />
                        <div
                          className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white shadow"
                          style={{
                            left: `${Math.min(100, Math.max(0, ((sbi.sbi + 2) / 10) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>
                    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-[#0b1220] px-3 py-2">
                        <dt className="text-xs text-slate-500">Sep. al snap</dt>
                        <dd className="font-mono text-lg">{sbi.sep_at_snap ?? '—'} yd</dd>
                      </div>
                      <div className="rounded-xl bg-[#0b1220] px-3 py-2">
                        <dt className="text-xs text-slate-500">Sep. a 1.5 s</dt>
                        <dd className="font-mono text-lg">{sbi.sep_at_1_5s ?? '—'} yd</dd>
                      </div>
                      <div className="rounded-xl bg-[#0b1220] px-3 py-2">
                        <dt className="text-xs text-slate-500">Δ separación</dt>
                        <dd
                          className={`font-mono text-lg ${
                            (sbi.delta_separation ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {(sbi.delta_separation ?? 0) > 0 ? '+' : ''}
                          {sbi.delta_separation} yd
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#0b1220] px-3 py-2">
                        <dt className="text-xs text-slate-500">Ventaja velocidad</dt>
                        <dd
                          className={`font-mono text-lg ${
                            (sbi.speed_advantage ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {(sbi.speed_advantage ?? 0) > 0 ? '+' : ''}
                          {sbi.speed_advantage}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="mt-6 text-slate-500">Selecciona una jugada para ver el SBI.</p>
                )}
              </div>

              <div className="rounded-2xl border border-white/5 bg-[#121a2b] p-5 shadow-xl">
                <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Separación en el tiempo
                </h3>
                <p className="mb-3 text-xs text-slate-500">Distancia al defensor y velocidad del receptor</p>
                <div className="h-56">
                  {sbiData?.separation_series?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sbiData.separation_series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} unit="s" />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} unit=" yd" width={42} />
                        <Tooltip
                          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12 }}
                          labelFormatter={(v) => `${v} s`}
                        />
                        {sbi?.snap_frame != null && (
                          <ReferenceLine
                            x={(sbi.snap_frame - 1) * 0.1}
                            stroke="#94a3b8"
                            strokeDasharray="4 4"
                            label={{ value: 'Snap', fill: '#94a3b8', fontSize: 10 }}
                          />
                        )}
                        {sbi?.burst_frame != null && (
                          <ReferenceLine
                            x={(sbi.burst_frame - 1) * 0.1}
                            stroke="#34d399"
                            strokeDasharray="4 4"
                            label={{ value: '1.5s', fill: '#34d399', fontSize: 10 }}
                          />
                        )}
                        <Line type="monotone" dataKey="separation" name="Separación" stroke="#10b981" strokeWidth={2.2} dot={false} />
                        <Line type="monotone" dataKey="target_speed" name="Vel. receptor" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
                        <Legend />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500">Sin serie</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[#121a2b] p-5 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Lectura rápida</h3>
                  <p className="text-xs text-slate-500">Resumen en lenguaje de cancha</p>
                </div>
                <button
                  type="button"
                  onClick={askInsight}
                  disabled={!selected}
                  className="rounded-lg bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                >
                  Generar insight
                </button>
              </div>
              {insight ? (
                <p className="mt-4 text-sm leading-relaxed text-slate-200">{insight}</p>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Pulsa el botón para una lectura corta de esta ruta.</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSection('inicio')}
              className="rounded-xl border border-white/10 bg-[#1a2744] px-4 py-2 text-sm font-medium hover:bg-[#243556]"
            >
              Volver al replay
            </button>
          </section>
        )}

        <footer className="pb-10 pt-4 text-center text-xs text-slate-600">
          NFL Data · Big Data Bowl UNAM · tracking + Separation Burst Index
        </footer>
      </main>
    </div>
  )
}
