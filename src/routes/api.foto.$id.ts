import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

export const Route = createFileRoute('/api/foto/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/.test(params.id)) {
          return new Response('No encontrada', { status: 404 })
        }
        const foto = await getStore('fotos').get(`${params.id}.jpg`, {
          type: 'arrayBuffer',
        })
        if (!foto) return new Response('No encontrada', { status: 404 })
        return new Response(foto, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
