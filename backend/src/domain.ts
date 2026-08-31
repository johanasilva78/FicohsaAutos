export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/tiff',
])
export const MAX_FILE_SIZE = 10 * 1024 * 1024
export const MAX_FILES = 10

export type EvidenceInput = { name: string; contentType: string; size: number }
export type ClaimInput = {
  policyNumber: string
  occurredAt: string
  insuredName: string
  identityDocument: string
  vehicle: string
  plate: string
  location: string
  description: string
  evidence: EvidenceInput[]
}

export function validateClaim(value: unknown): ClaimInput {
  if (!value || typeof value !== 'object') throw new Error('El cuerpo de la solicitud es inválido')
  const body = value as Record<string, unknown>
  const required = ['policyNumber', 'occurredAt', 'insuredName', 'identityDocument', 'vehicle', 'plate', 'location', 'description'] as const
  const clean: Record<string, string> = {}
  for (const field of required) {
    if (typeof body[field] !== 'string' || !body[field].trim()) throw new Error(`El campo ${field} es obligatorio`)
    clean[field] = body[field].trim()
  }
  if (clean.description.length > 2000) throw new Error('La descripción excede 2000 caracteres')
  const evidence = Array.isArray(body.evidence) ? body.evidence : []
  if (evidence.length > MAX_FILES) throw new Error(`Solo se permiten ${MAX_FILES} archivos`)
  const safeEvidence = evidence.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Evidencia ${index + 1} inválida`)
    const file = item as Record<string, unknown>
    if (typeof file.name !== 'string' || !file.name.trim()) throw new Error(`Nombre de evidencia ${index + 1} inválido`)
    if (typeof file.contentType !== 'string' || !ALLOWED_CONTENT_TYPES.has(file.contentType)) throw new Error(`Tipo de evidencia no permitido: ${String(file.contentType)}`)
    if (typeof file.size !== 'number' || file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error(`La evidencia ${file.name} excede 10 MB`)
    return { name: file.name.slice(0, 160), contentType: file.contentType, size: file.size }
  })
  return { ...clean, plate: clean.plate.toUpperCase(), evidence: safeEvidence } as ClaimInput
}

export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() || 'archivo'
  return base.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^\.+/, '').slice(0, 160) || 'archivo'
}

export function normalizeAnalysis(value: unknown) {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const score = Math.max(0, Math.min(100, Number(data.score) || 0))
  const findings = Array.isArray(data.findings) ? data.findings.slice(0, 8).map((x) => {
    const f = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    return { title: String(f.title || 'Hallazgo'), detail: String(f.detail || ''), impact: Math.max(0, Math.min(40, Number(f.impact) || 0)), evidence: String(f.evidence || 'Datos del siniestro') }
  }) : []
  return {
    score,
    risk: score >= 70 ? 'Alto' : score >= 35 ? 'Medio' : 'Bajo',
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    recommendation: String(data.recommendation || (score >= 70 ? 'Escalar a investigación' : score >= 35 ? 'Revisión manual' : 'Continuar proceso')),
    summary: String(data.summary || 'Análisis completado'),
    findings,
  }
}
