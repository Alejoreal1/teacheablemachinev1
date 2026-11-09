import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'
import { z } from 'zod'

const MAX_PHOTO_BYTES = 1_500_000

const input = z.object({
  estacion: z.string().trim().min(1).max(80),
  clase: z.string().trim().min(1).max(80),
  confianza: z.number().min(0).max(1),
  modo: z.enum(['Automático', 'Manual']),
  foto: z.string().startsWith('data:image/jpeg;base64,').max(2_100_000),
  webhookUrl: z.string().trim().max(500).optional(),
})

function resolveWebhook(fromClient?: string): string | null {
  const candidate = process.env.GOOGLE_SHEETS_WEBHOOK_URL || fromClient || ''
  try {
    const url = new URL(candidate)
    if (url.protocol === 'https:' && url.hostname === 'script.google.com') {
      return url.toString()
    }
  } catch {
    // invalid URL
  }
  return null
}

export const Route = createFileRoute('/api/registro')({
  server: {
    handlers: {
      // Status / connection test: GET /api/registro?url=<apps script url>
      GET: async ({ request }) => {
        const fromEnv = Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL)
        const fromClient = new URL(request.url).searchParams.get('url') ?? undefined
        const webhook = resolveWebhook(fromClient)
        if (!webhook) return Response.json({ configured: fromEnv, ok: false })
        try {
          const res = await fetch(webhook, { redirect: 'follow' })
          const json = (await res.json()) as { ok?: boolean }
          return Response.json({ configured: fromEnv, ok: res.ok && Boolean(json.ok) })
        } catch {
          return Response.json({ configured: fromEnv, ok: false })
        }
      },
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'JSON inválido' }, { status: 400 })
        }
        const parsed = input.safeParse(body)
        if (!parsed.success) {
          return Response.json({ error: 'Datos de registro inválidos' }, { status: 400 })
        }
        const data = parsed.data

        const webhook = resolveWebhook(data.webhookUrl)
        if (!webhook) {
          return Response.json(
            { error: 'Falta la URL de la Web App de Google Apps Script' },
            { status: 400 },
          )
        }

        const bytes = Buffer.from(data.foto.split(',')[1] ?? '', 'base64')
        if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
          return Response.json({ error: 'Foto inválida' }, { status: 400 })
        }

        const id = crypto.randomUUID()
        const store = getStore('fotos')
        await store.set(`${id}.jpg`, new Uint8Array(bytes).buffer, {
          metadata: { contentType: 'image/jpeg', clase: data.clase },
        })

        const origin = new URL(request.url).origin
        const fotoUrl = `${origin}/api/foto/${id}`
        const fecha = new Date().toISOString()

        try {
          const res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              fecha,
              estacion: data.estacion,
              clase: data.clase,
              confianza: data.confianza,
              modo: data.modo,
              foto: fotoUrl,
            }),
            redirect: 'follow',
          })
          if (!res.ok) {
            return Response.json(
              { error: `Google Sheets respondió con estado ${res.status}`, fotoUrl },
              { status: 502 },
            )
          }
          const text = await res.text()
          let ok = false
          try {
            ok = Boolean((JSON.parse(text) as { ok?: boolean }).ok)
          } catch {
            ok = false
          }
          if (!ok) {
            return Response.json(
              {
                error:
                  'Google Sheets no confirmó el registro. Revisa que la Web App esté implementada con acceso para "Cualquier persona".',
                fotoUrl,
              },
              { status: 502 },
            )
          }
        } catch {
          return Response.json(
            { error: 'No se pudo conectar con Google Sheets', fotoUrl },
            { status: 502 },
          )
        }

        return Response.json({ ok: true, fecha, fotoUrl })
      },
    },
  },
})
