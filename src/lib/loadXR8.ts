import type { XR8Api } from '../types/xr8'

/**
 * Resolves the XR8 global loaded by the engine-binary script tag in index.html.
 * The script loads async, so we either find it immediately or wait for the
 * `xrloaded` event the engine fires when ready.
 */
export function loadXR8(timeoutMs = 20000): Promise<XR8Api> {
  return new Promise((resolve, reject) => {
    if (window.XR8) {
      resolve(window.XR8)
      return
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener('xrloaded', onLoaded)
      reject(new Error('The 8th Wall engine (xr.js) did not load. Check the network connection and the script tag in index.html.'))
    }, timeoutMs)

    const onLoaded = () => {
      window.clearTimeout(timer)
      if (window.XR8) {
        resolve(window.XR8)
      } else {
        reject(new Error('xrloaded fired but the XR8 global is missing.'))
      }
    }

    window.addEventListener('xrloaded', onLoaded, { once: true })
  })
}
