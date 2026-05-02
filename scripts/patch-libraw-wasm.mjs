import fs from 'fs'
import path from 'path'
const source = path.resolve('patches/libraw-wasm-worker.js')
const target = path.resolve('node_modules/libraw-wasm/dist/worker.js')
if (!fs.existsSync(source) || !fs.existsSync(target)) process.exit(0)
fs.copyFileSync(source, target)
console.log('patched libraw-wasm worker.js')
