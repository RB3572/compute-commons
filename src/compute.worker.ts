type WorkRequest = { type: 'run'; unitId: number; samples: number }

function mulberry32(seed: number) {
  return function random() {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

self.onmessage = ({ data }: MessageEvent<WorkRequest>) => {
  if (data.type !== 'run') return
  const random = mulberry32(data.unitId + 104729)
  let sum = 0
  for (let index = 0; index < data.samples; index += 1) {
    const lowCloudResponse = 0.74 + random() * 0.52
    const forcing = 0.8 + random() * 0.4
    sum += lowCloudResponse * forcing
  }
  const estimate = sum / data.samples
  const checksum = Math.round(estimate * 1_000_000) ^ data.unitId
  self.postMessage({ unitId: data.unitId, estimate, checksum })
}
