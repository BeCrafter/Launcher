// 3D 模型:three.js + OrbitControls。GLB / STL / OBJ 解析字节;GLTF 走协议 URL
// (相对 .bin / 贴图自然解析)。只读,不自动旋转;滚轮缩放、拖拽旋转、右键平移。

import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../hooks/useT'
import { FilePlaceholder } from './FilePlaceholder'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function ModelView({
  name,
  data,
  url
}: {
  name: string
  data?: Uint8Array
  url?: string
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    let frame = 0
    let resizeObserver: ResizeObserver | null = null
    let cleanup: (() => void) | null = null

    void (async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
        if (disposed) return

        const width = Math.max(1, host.clientWidth)
        const height = Math.max(1, host.clientHeight)
        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 10000)
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(width, height)
        host.appendChild(renderer.domElement)
        renderer.domElement.setAttribute('data-model-canvas', '1')

        scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.6))
        const dir = new THREE.DirectionalLight(0xffffff, 1.4)
        dir.position.set(3, 5, 4)
        scene.add(dir)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08

        const ext = extOf(name)
        let root: import('three').Object3D | null = null
        if (ext === 'glb' || ext === 'gltf') {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
          const loader = new GLTFLoader()
          if (url !== undefined) {
            const gltf = await loader.loadAsync(url)
            root = gltf.scene
          } else if (data !== undefined) {
            const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
            const gltf = await loader.parseAsync(buffer, '')
            root = gltf.scene
          }
        } else if (ext === 'obj') {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
          const text = new TextDecoder().decode(data ?? new Uint8Array())
          root = new OBJLoader().parse(text)
        } else if (ext === 'stl') {
          const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
          const buffer = (data ?? new Uint8Array()).buffer.slice(
            data?.byteOffset ?? 0,
            (data?.byteOffset ?? 0) + (data?.byteLength ?? 0)
          ) as ArrayBuffer
          const geometry = new STLLoader().parse(buffer)
          geometry.computeVertexNormals()
          root = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.6, metalness: 0.1 })
          )
        }
        if (root === null) throw new Error('unsupported model')
        if (disposed) return
        scene.add(root)

        // 按包围盒自动取景
        const box = new THREE.Box3().setFromObject(root)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const radius = Math.max(size.length() * 0.5, 0.5)
        camera.near = Math.max(radius / 1000, 0.001)
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        const distance = radius * 2.4
        camera.position.set(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance)
        controls.target.copy(center)
        controls.update()

        resizeObserver = new ResizeObserver(() => {
          const w = Math.max(1, host.clientWidth)
          const h = Math.max(1, host.clientHeight)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          renderer.setSize(w, h)
        })
        resizeObserver.observe(host)

        const tick = (): void => {
          controls.update()
          renderer.render(scene, camera)
          frame = requestAnimationFrame(tick)
        }
        tick()
        setLoaded(true)

        cleanup = () => {
          cancelAnimationFrame(frame)
          resizeObserver?.disconnect()
          controls.dispose()
          scene.traverse((obj: import('three').Object3D) => {
            const mesh = obj as import('three').Mesh
            mesh.geometry?.dispose()
            const mat = mesh.material
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat?.dispose()
          })
          renderer.dispose()
          renderer.domElement.remove()
        }
      } catch (err) {
        if (!disposed) {
          console.warn('model preview failed', name, err)
          setFailed(true)
        }
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
      host.innerHTML = ''
    }
  }, [name, data, url])

  if (failed) {
    return <FilePlaceholder path="" icon="fa-cube" title={t('notes.file.modelFailed')} />
  }

  return (
    <div className="file-model" data-model-state={loaded ? 'loaded' : 'loading'}>
      <div ref={hostRef} className="file-model-host" />
      {!loaded && (
        <div className="file-placeholder" role="status">
          <i className="fa-solid fa-circle-notch fa-spin" />
          <div>{t('notes.file.loading')}</div>
        </div>
      )}
    </div>
  )
}
