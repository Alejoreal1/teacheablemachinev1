/**
 * Loads the Teachable Machine image model with TensorFlow.js and classifies
 * webcam frames using the same preprocessing Teachable Machine uses:
 * mirrored, center-cropped square, resized to imageSize, normalized to [-1, 1].
 * Browser-only: import it dynamically from client code.
 */
export const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/GLcHeZx-M/'

/** Class that means "nobody in front of the camera"; never auto-registered. */
export const EMPTY_CLASS = 'Nadie'

export type Prediction = { className: string; probability: number }

export type Classifier = {
  labels: string[]
  predict: (video: HTMLVideoElement) => Prediction[]
}

export async function loadClassifier(): Promise<Classifier> {
  const tf = await import('@tensorflow/tfjs')
  await tf.ready()

  const [model, meta] = await Promise.all([
    tf.loadLayersModel(`${MODEL_URL}model.json`),
    fetch(`${MODEL_URL}metadata.json`).then((r) => {
      if (!r.ok) throw new Error('No se pudo leer metadata.json del modelo')
      return r.json() as Promise<{ labels: string[]; imageSize?: number }>
    }),
  ])

  const size = meta.imageSize ?? 224
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('El navegador no soporta canvas 2D')

  function predict(video: HTMLVideoElement): Prediction[] {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh || !ctx) return []
    const side = Math.min(vw, vh)
    ctx.save()
    ctx.translate(size, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size)
    ctx.restore()

    const output = tf.tidy(() => {
      const img = tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1).expandDims(0)
      return model.predict(img) as import('@tensorflow/tfjs').Tensor
    })
    const probs = output.dataSync()
    output.dispose()
    return meta.labels.map((className, i) => ({ className, probability: probs[i] ?? 0 }))
  }

  return { labels: meta.labels, predict }
}

/** Mirrored JPEG snapshot of the current video frame (matches what the user sees). */
export function captureFrame(video: HTMLVideoElement, width = 480): string {
  const ratio = video.videoHeight / video.videoWidth || 0.75
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.round(width * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}
