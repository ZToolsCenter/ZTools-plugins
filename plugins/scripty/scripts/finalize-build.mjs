import { DIST_ROOT, finalizeDistDirectory, listFiles } from './build-lib.mjs'

/** Converts Vite output into the final self-contained dist directory and reports its file count. */
async function main() {
  await finalizeDistDirectory()
  console.log(JSON.stringify({ directory: DIST_ROOT, files: listFiles(DIST_ROOT).length }, null, 2))
}

await main()
