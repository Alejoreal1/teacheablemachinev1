import { useState } from 'react'
import { Check, Copy, ExternalLink, Loader2, PlugZap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APPS_SCRIPT_CODE } from '@/lib/apps-script'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  webhookUrl: string
  onSave: (url: string) => void
  serverConfigured: boolean
}

const STEPS = [
  <>
    Crea una hoja nueva en{' '}
    <a
      href="https://sheets.new"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      sheets.new <ExternalLink className="size-3" />
    </a>
    .
  </>,
  <>
    Abre <b>Extensiones → Apps Script</b>, borra lo que haya y pega el código de abajo. Guarda.
  </>,
  <>
    Pulsa <b>Implementar → Nueva implementación</b>, tipo <b>Aplicación web</b>. Ejecutar como:{' '}
    <b>Yo</b>. Quién tiene acceso: <b>Cualquier persona</b>. Autoriza los permisos.
  </>,
  <>
    Copia la <b>URL de la aplicación web</b> (termina en <code>/exec</code>) y pégala aquí.
  </>,
]

export function SheetsSetupDialog({
  open,
  onOpenChange,
  webhookUrl,
  onSave,
  serverConfigured,
}: Props) {
  const [draft, setDraft] = useState(webhookUrl)
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState(false)

  const valid = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(draft.trim())

  async function copyCode() {
    await navigator.clipboard.writeText(APPS_SCRIPT_CODE)
    setCopied(true)
    toast.success('Código copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  async function testAndSave() {
    setTesting(true)
    try {
      const res = await fetch(`/api/registro?url=${encodeURIComponent(draft.trim())}`)
      const json = (await res.json()) as { ok: boolean }
      if (json.ok) {
        onSave(draft.trim())
        toast.success('Conectado con Google Sheets', {
          description: 'Se creó la pestaña "Registros" con los encabezados.',
        })
        onOpenChange(false)
      } else {
        toast.error('No se pudo conectar', {
          description: 'Revisa que la implementación tenga acceso para "Cualquier persona".',
        })
      }
    } catch {
      toast.error('No se pudo conectar')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(webhookUrl)
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Conectar Google Sheets</DialogTitle>
          <DialogDescription>
            Cada detección agrega una fila con <b>Fecha, Estación, Clase, Confianza, Modo y Foto</b>.
          </DialogDescription>
        </DialogHeader>

        {serverConfigured && (
          <p className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
            Este sitio ya tiene una hoja configurada en el servidor. Solo necesitas este paso si
            quieres usar una hoja diferente.
          </p>
        )}

        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-data text-xs font-medium text-primary-foreground">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="relative">
          <pre className="max-h-56 overflow-auto rounded-lg border bg-background p-4 font-data text-xs leading-relaxed text-muted-foreground">
            {APPS_SCRIPT_CODE}
          </pre>
          <Button
            size="sm"
            variant="secondary"
            className="absolute top-2 right-2"
            onClick={copyCode}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copiado' : 'Copiar código'}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="webhook">URL de la aplicación web</Label>
          <Input
            id="webhook"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="font-data text-xs"
          />
          {draft && !valid && (
            <p className="text-xs text-destructive">
              Debe empezar por https://script.google.com/macros/s/ y terminar en /exec
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={testAndSave} disabled={!valid || testing}>
            {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Probar y guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
