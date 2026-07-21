/**
 * Remove source-only HTML comments from Astro's generated pages.
 *
 * Astro already minifies markup and Vite minifies JavaScript and CSS. It
 * intentionally preserves HTML comments, so this final build step keeps
 * component-maintenance notes out of deployed page source.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../client/dist/', import.meta.url))
const HTML_COMMENT_PATTERN = /<!--(?!\[if\b)[\s\S]*?-->/gi

async function stripComments(directory) {
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return stripComments(path)
      if (!entry.isFile() || !entry.name.endsWith('.html')) return

      const html = await readFile(path, 'utf8')
      const minifiedHtml = html.replace(HTML_COMMENT_PATTERN, '')
      if (minifiedHtml !== html) await writeFile(path, minifiedHtml)
    })
  )
}

await stripComments(OUTPUT_DIRECTORY)
