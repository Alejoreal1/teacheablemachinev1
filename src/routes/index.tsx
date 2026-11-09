import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Loader2,
  ScanFace,
  Sheet as SheetIcon,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SheetsSetupDialog } from '@/components/sheets-setup-dialog'
import type { Classifier, Prediction } from '@/lib/classifier'
import { EMPTY_CLASS, MODEL_URL, captureFrame } from '@/lib/classifier'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Home,
})

type Modo = 'Automático' | 'Manual'

type Settings = {
  estacion: string
  webhookUrl: string
  auto: boolean
  threshold: number
  cooldown: number
  voice: boolean
}

type Registro = {
  id: string
  fecha: Date
  clase: string
  confianza: number
  modo: Modo
  foto: string
  estado: 'enviando' | 'ok' | 'error'
  error?: string
}

type Status = 'idle' | 'loading' | 'running' | 'error'

const DEFAULT_SETTINGS: Settings = {
  estacion: 'Entrada principal',
  webhookUrl: '',
  auto: true,
  threshold: 0.85,
  cooldown: 30,
  voice: true,
}

const STORAGE_KEY = 'vigia:settings'
const PREDICT_INTERVAL_MS = 150
/** How long a person must be recognized continuously before auto-registering. */
const STABLE_MS = 1200

const CLASS_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
]

function colorFor(className: string, labels: string[]) {
  if (className === EMPTY_CLASS) return 'var(--chart-5)'
  const i = labels.filter((l) => l !== EMPTY_CLASS).indexOf(className)
  return CLASS_COLORS[Math.max(0, i) % CLASS_COLORS.length]
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'es-ES'
  u.rate = 1
  window.speechSynthesis.speak(u)
}

const timeFmt = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function Home() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const classifierRef = useRef<Classifier | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [registros, setRegistros] = useState<Registro[]>([])
  const [serverConfigured, setServerConfigured] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [flash, setFlash] = useState(false)

  const settingsRef = useRef(settings)
  const sheetsReady = serverConfigured || Boolean(settings.webhookUrl)
  const sheetsReadyRef = useRef(sheetsReady)
  useEffect(() => {
    settingsRef.current = settings
    sheetsReadyRef.current = sheetsReady
  }, [settings, sheetsReady])

  // Load persisted settings and server config (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) })
    } catch {
      // ignore corrupted storage
    }
    fetch('/api/registro')
      .then((r) => r.json() as Promise<{ configured: boolean }>)
      .then((j) => setServerConfigured(j.configured))
      .catch(() => setServerConfigured(false))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const registrar = useCallback(async (modo: Modo, pred: Prediction) => {
    const video = videoRef.current
    if (!video) return
    const foto = captureFrame(video)
    const id = crypto.randomUUID()
    const s = settingsRef.current
    setFlash(true)
    setTimeout(() => setFlash(false), 250)
    setRegistros((prev) =>
      [
        {
          id,
          fecha: new Date(),
          clase: pred.className,
          confianza: pred.probability,
          modo,
          foto,
          estado: 'enviando' as const,
        },
        ...prev,
      ].slice(0, 30),
    )

    if (!sheetsReadyRef.current) {
      setRegistros((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, estado: 'error', error: 'Google Sheets sin conectar' } : r,
        ),
      )
      return
    }

    try {
      const res = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estacion: s.estacion.trim() || DEFAULT_SETTINGS.estacion,
          clase: pred.className,
          confianza: Number(pred.probability.toFixed(4)),
          modo,
          foto,
          webhookUrl: s.webhookUrl || undefined,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al registrar')
      setRegistros((prev) => prev.map((r) => (r.id === id ? { ...r, estado: 'ok' } : r)))
      toast.success(`${pred.className} registrado en Google Sheets`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al registrar'
      setRegistros((prev) =>
        prev.map((r) => (r.id === id ? { ...r, estado: 'error', error: message } : r)),
      )
      toast.error('No se pudo registrar', { description: message })
    }
  }, [])

  const registrarRef = useRef(registrar)

  const start = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      const [{ loadClassifier }, stream] = await Promise.all([
        import('@/lib/classifier'),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        }),
      ])
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('Video no disponible')
      video.srcObject = stream
      await video.play()
      const classifier = await loadClassifier()
      classifierRef.current = classifier
      setLabels(classifier.labels)
      setStatus('running')
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const name = err instanceof DOMException ? err.name : ''
      setErrorMsg(
        name === 'NotAllowedError'
          ? 'Necesito permiso para usar la cámara. Actívalo en la barra del navegador.'
          : name === 'NotFoundError'
            ? 'No se encontró ninguna cámara conectada.'
            : 'No se pudo iniciar la cámara o cargar el modelo de Teachable Machine.',
      )
      setStatus('error')
    }
  }, [])

  // Stop camera on unmount.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  // Prediction loop + auto-registration.
  useEffect(() => {
    if (status !== 'running') return
    let raf = 0
    let last = 0
    let smoothed: number[] = []
    let candidate = ''
    let candidateSince = 0
    let greeted = ''
    const lastLogged = new Map<string, number>()

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (t - last < PREDICT_INTERVAL_MS) return
      last = t
      const video = videoRef.current
      const classifier = classifierRef.current
      if (!video || !classifier) return
      const preds = classifier.predict(video)
      if (!preds.length) return

      smoothed = preds.map((p, i) => (smoothed[i] ?? p.probability) * 0.5 + p.probability * 0.5)
      const current = preds.map((p, i) => ({ ...p, probability: smoothed[i] ?? p.probability }))
      setPredictions(current)

      const s = settingsRef.current
      const top = current.reduce((a, b) => (b.probability > a.probability ? b : a))
      const person = top.className !== EMPTY_CLASS && top.probability >= s.threshold
      const now = performance.now()

      if (!person) {
        candidate = ''
        if (top.className === EMPTY_CLASS && top.probability >= s.threshold) greeted = ''
        return
      }
      if (candidate !== top.className) {
        candidate = top.className
        candidateSince = now
        return
      }
      if (now - candidateSince < STABLE_MS) return

      if (greeted !== top.className) {
        greeted = top.className
        if (s.voice) speak(`Hola, ${top.className}`)
      }

      const prev = lastLogged.get(top.className) ?? -Infinity
      if (s.auto && now - prev > s.cooldown * 1000) {
        lastLogged.set(top.className, now)
        void registrarRef.current('Automático', top)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status])

  const top = predictions.length
    ? predictions.reduce((a, b) => (b.probability > a.probability ? b : a))
    : null
  const recognized =
    top && top.className !== EMPTY_CLASS && top.probability >= settings.threshold ? top : null
  const accent = recognized ? colorFor(recognized.className, labels) : 'var(--chart-5)'

  const manual = () => {
    if (top) void registrar('Manual', top)
  }

  return (
    <div className="grid-bg min-h-screen">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ScanFace className="size-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl leading-none font-extrabold tracking-tight">
                Vigía
              </h1>
              <p className="text-xs text-muted-foreground">Registro facial en Google Sheets</p>
            </div>
          </div>
          <Button
            variant={sheetsReady ? 'secondary' : 'default'}
            onClick={() => setSetupOpen(true)}
          >
            <FileSpreadsheet />
            {sheetsReady ? 'Sheets conectado' : 'Conectar Google Sheets'}
            {sheetsReady && <span className="size-2 rounded-full bg-primary" aria-hidden />}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-content gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Camera */}
        <section className="space-y-4">
          <div
            className="relative aspect-[4/3] overflow-hidden rounded-2xl border-2 bg-black transition-colors duration-300 motion-reduce:transition-none"
            style={{ borderColor: recognized ? accent : undefined }}
          >
            <video
              ref={videoRef}
              className="size-full -scale-x-100 object-cover"
              playsInline
              muted
            />

            {status === 'running' && (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1/4 scanline motion-reduce:hidden" />
                {(['top-4 left-4 border-t-2 border-l-2', 'top-4 right-4 border-t-2 border-r-2', 'bottom-4 left-4 border-b-2 border-l-2', 'right-4 bottom-4 border-r-2 border-b-2'] as const).map(
                  (pos) => (
                    <span
                      key={pos}
                      className={cn('pointer-events-none absolute size-8 rounded-sm', pos)}
                      style={{ borderColor: accent }}
                    />
                  ),
                )}
                <div className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1 font-data text-xs text-white">
                  <span className="size-2 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" />
                  {settings.estacion || DEFAULT_SETTINGS.estacion}
                </div>
              </>
            )}

            {flash && <div className="absolute inset-0 bg-white/40" />}

            {/* Greeting */}
            {status === 'running' && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 pt-16">
                {recognized ? (
                  <div className="animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
                    <p className="font-data text-xs tracking-widest text-white/70 uppercase">
                      Persona reconocida
                    </p>
                    <p
                      className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl"
                      style={{ color: accent }}
                    >
                      ¡Hola, {recognized.className}!
                    </p>
                    <p className="font-data text-sm text-white/80">
                      Confianza {(recognized.probability * 100).toFixed(1)}%
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-data text-xs tracking-widest text-white/60 uppercase">
                      {top?.className === EMPTY_CLASS ? 'Sin nadie a la vista' : 'Analizando…'}
                    </p>
                    <p className="font-display text-3xl font-bold text-white/80">
                      Acércate a la cámara
                    </p>
                  </div>
                )}
              </div>
            )}

            {status !== 'running' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                {status === 'loading' ? (
                  <>
                    <Loader2 className="size-10 animate-spin text-primary" />
                    <p className="text-white/80">Encendiendo cámara y cargando el modelo…</p>
                  </>
                ) : (
                  <>
                    <div className="flex size-20 items-center justify-center rounded-full border-2 border-primary/50 bg-primary/10">
                      {status === 'error' ? (
                        <AlertTriangle className="size-9 text-destructive" />
                      ) : (
                        <Camera className="size-9 text-primary" />
                      )}
                    </div>
                    <div className="max-w-sm space-y-1">
                      <p className="font-display text-2xl font-bold text-white">
                        {status === 'error' ? 'Algo salió mal' : '¿Quién está ahí?'}
                      </p>
                      <p className="text-sm text-white/70">
                        {status === 'error'
                          ? errorMsg
                          : 'Activa la cámara para reconocer caras con tu modelo de Teachable Machine.'}
                      </p>
                    </div>
                    <Button size="lg" onClick={start}>
                      <Camera />
                      {status === 'error' ? 'Reintentar' : 'Activar cámara'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Confidence bars */}
          <div className="rounded-2xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Confianza por clase</h2>
              <a
                href={MODEL_URL}
                target="_blank"
                rel="noreferrer"
                className="font-data text-xs text-muted-foreground hover:text-foreground"
              >
                modelo GLcHeZx-M ↗
              </a>
            </div>
            {predictions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Las barras aparecen cuando la cámara está activa.
              </p>
            ) : (
              <ul className="space-y-3">
                {predictions.map((p) => (
                  <li key={p.className} className="grid grid-cols-[5rem_1fr_3.5rem] items-center gap-3">
                    <span className="truncate text-sm font-medium">{p.className}</span>
                    <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none"
                        style={{
                          width: `${p.probability * 100}%`,
                          background: colorFor(p.className, labels),
                        }}
                      />
                      <div
                        className="absolute inset-y-0 w-px bg-foreground/50"
                        style={{ left: `${settings.threshold * 100}%` }}
                        aria-hidden
                      />
                    </div>
                    <span className="text-right font-data text-sm tabular-nums">
                      {(p.probability * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-6">
          <div className="space-y-5 rounded-2xl border bg-card p-5">
            <h2 className="font-display text-lg font-bold">Estación</h2>

            <div className="space-y-2">
              <Label htmlFor="estacion">Nombre de la estación</Label>
              <Input
                id="estacion"
                value={settings.estacion}
                maxLength={80}
                onChange={(e) => updateSettings({ estacion: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="auto">Modo automático</Label>
                <p className="text-xs text-muted-foreground">
                  Registra solo al reconocer a alguien
                </p>
              </div>
              <Switch
                id="auto"
                checked={settings.auto}
                onCheckedChange={(auto) => updateSettings({ auto })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="threshold">Confianza mínima</Label>
                <span className="font-data text-sm">{Math.round(settings.threshold * 100)}%</span>
              </div>
              <input
                id="threshold"
                type="range"
                min={50}
                max={99}
                value={Math.round(settings.threshold * 100)}
                onChange={(e) => updateSettings({ threshold: Number(e.target.value) / 100 })}
                className="w-full accent-[var(--primary)]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="cooldown">Espera entre registros</Label>
                <span className="font-data text-sm">{settings.cooldown} s</span>
              </div>
              <input
                id="cooldown"
                type="range"
                min={5}
                max={300}
                step={5}
                value={settings.cooldown}
                onChange={(e) => updateSettings({ cooldown: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]"
              />
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={manual} disabled={status !== 'running'}>
                <Camera />
                Registrar ahora
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label={settings.voice ? 'Silenciar saludo' : 'Activar saludo por voz'}
                onClick={() => updateSettings({ voice: !settings.voice })}
              >
                {settings.voice ? <Volume2 /> : <VolumeX />}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Registros</h2>
              <span className="font-data text-xs text-muted-foreground">
                {registros.length} en esta sesión
              </span>
            </div>

            {!sheetsReady && (
              <button
                type="button"
                onClick={() => setSetupOpen(true)}
                className="mb-4 flex w-full items-start gap-3 rounded-lg border border-dashed border-primary/50 p-3 text-left text-sm transition-colors hover:bg-primary/5 motion-reduce:transition-none"
              >
                <SheetIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <b>Conecta tu hoja de Google Sheets</b> para guardar cada detección. Toma 2
                  minutos.
                </span>
              </button>
            )}

            {registros.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Clock className="size-6" />
                Aún no hay registros
              </div>
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {registros.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-2">
                    <img
                      src={r.foto}
                      alt={`Foto de ${r.clase}`}
                      className="size-12 shrink-0 rounded-md object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        <span style={{ color: colorFor(r.clase, labels) }}>{r.clase}</span>{' '}
                        <span className="font-data text-xs font-normal text-muted-foreground">
                          {(r.confianza * 100).toFixed(1)}%
                        </span>
                      </p>
                      <p className="font-data text-xs text-muted-foreground">
                        {timeFmt.format(r.fecha)} · {r.modo}
                      </p>
                      {r.error && <p className="truncate text-xs text-destructive">{r.error}</p>}
                    </div>
                    {r.estado === 'enviando' && (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Enviando" />
                    )}
                    {r.estado === 'ok' && (
                      <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label="Guardado" />
                    )}
                    {r.estado === 'error' && (
                      <XCircle className="size-4 shrink-0 text-destructive" aria-label="Error" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </main>

      <SheetsSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        webhookUrl={settings.webhookUrl}
        onSave={(webhookUrl) => updateSettings({ webhookUrl })}
        serverConfigured={serverConfigured}
      />
    </div>
  )
}
