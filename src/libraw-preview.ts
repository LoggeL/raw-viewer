import LibRaw from 'libraw-wasm'

type RawWithPreview = LibRaw & {
  thumbnailData?: () => Promise<Uint8Array | number[] | null>
}

const TRANSFERABLE_ARRAY_TYPES = [Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array]

export function patchLibRawPreviewSupport() {
  const proto = LibRaw.prototype as RawWithPreview
  if (proto.thumbnailData) return

  proto.thumbnailData = async function thumbnailData(this: RawWithPreview) {
    const workerClient = this as RawWithPreview & {
      runFn?: (fn: string, ...args: unknown[]) => Promise<unknown>
    }
    if (!workerClient.runFn) return null
    try {
      const result = await workerClient.runFn('thumbnailData')
      if (!result) return null
      if (result instanceof Uint8Array) return result
      if (Array.isArray(result)) return Uint8Array.from(result)
      if (TRANSFERABLE_ARRAY_TYPES.some((Type) => result instanceof Type)) return new Uint8Array((result as ArrayBufferView).buffer)
      return null
    } catch {
      return null
    }
  }
}
