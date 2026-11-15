// 更新检查的本地桩:端到端用例绝不能请求真实 CDN(repo.iskill.site)。
//
// 应用只认 LAUNCHER_R2_BASE 这一个口子(shared 的 versionsUrl / manifestUrl 都读它),
// 所以把整个 run 的检查指向这里即可。默认「最新版」= 当前构建版本,于是:
//   · 其余用例的每小时自动检查都是 upToDate,不会弹更新横幅、不会联网;
//   · update 用例里 setVersion() 把它抬到更高的版本,下一次自动检查就会找到更新。
//
// 下载路径只提供清单、安装包一律 404:用例只验证「横幅的下载按钮接到了既有下载机制」
// (发起了清单/安装包请求),不在这里演完整替换。

import { createServer } from 'node:http'

export function createUpdateStub({ version }) {
  let current = version
  const requests = []
  const sockets = new Set()

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://stub').pathname)
    requests.push(path)
    res.setHeader('cache-control', 'no-store')

    const versions = '/launcher/versions.txt'
    if (path === versions) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`${current}\n`)
      return
    }

    const manifest = /^\/launcher\/Launcher-(.+)\.json$/.exec(path)
    if (manifest !== null) {
      const version = manifest[1]
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          version,
          minSystemVersion: null,
          files: {
            arm64: {
              path: `Launcher-${version}-arm64.zip`,
              sha256: 'a'.repeat(64),
              size: 1
            },
            x64: {
              path: `Launcher-${version}-x64.zip`,
              sha256: 'a'.repeat(64),
              size: 1
            }
          }
        })
      )
      return
    }

    // 清单说能装、安装包却不存在:下载会走到错误分支,用例只看请求是否发出
    setTimeout(() => {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('stub: artifact not provided')
    }, 300)
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port)
    })
  })

  return {
    baseVersion: version,
    get requests() {
      return requests
    },
    async url() {
      const port = await listening
      return `http://127.0.0.1:${port}/launcher`
    },
    setVersion(next) {
      current = next
    },
    clearRequests() {
      requests.length = 0
    },
    async close() {
      await listening.catch(() => undefined)
      server.closeAllConnections?.()
      sockets.clear()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
