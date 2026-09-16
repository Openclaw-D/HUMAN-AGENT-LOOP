import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const distDirectory = resolve(projectRoot, 'dist')
const outputPath = resolve(projectRoot, 'STARS-领导演示版.html')

const builtHtml = await readFile(resolve(distDirectory, 'index.html'), 'utf8')
const scriptMatch = builtHtml.match(
  /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/,
)
const styleMatch = builtHtml.match(
  /<link\s+rel="stylesheet"\s+crossorigin\s+href="([^"]+)"\s*\/?>/,
)

if (!scriptMatch || !styleMatch) {
  throw new Error('没有在 dist/index.html 中找到 Vite 构建生成的脚本或样式。')
}

const toDistPath = (assetUrl) =>
  resolve(distDirectory, assetUrl.replace(/^\//, ''))

const [javascript, css] = await Promise.all([
  readFile(toDistPath(scriptMatch[1]), 'utf8'),
  readFile(toDistPath(styleMatch[1]), 'utf8'),
])

// 避免内联资源中的闭合标签意外提前结束 script/style 元素。
const safeJavascript = javascript.replaceAll('</script', '<\\/script')
const safeCss = css.replaceAll('</style', '<\\/style')

const standaloneHtml = builtHtml
  .replace(
    '<head>',
    '<head>\n    <!-- STARS 领导演示版：单文件运行，页面内容为前端模拟数据。 -->',
  )
  // 使用替换函数，避免构建代码中的 $& 被 String.replace 当成特殊替换标记。
  .replace(scriptMatch[0], '')
  .replace(styleMatch[0], () => `<style>${safeCss}</style>`)
  // 普通内联脚本放在 body 末尾，确保 #root 已解析后再挂载 React 页面。
  .replace('</body>', () => `  <script>${safeJavascript}</script>\n  </body>`)

await writeFile(outputPath, standaloneHtml, 'utf8')

const sizeInBytes = Buffer.byteLength(standaloneHtml, 'utf8')
const sizeInKiB = (sizeInBytes / 1024).toFixed(1)
console.log(`已生成：${outputPath}`)
console.log(`文件大小：${sizeInBytes} bytes（${sizeInKiB} KiB）`)
