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

export type AnalysisContext = {
  evidenceCount?: number
  description?: string
  occurredAt?: string
  history?: { sameIdentity?:number; samePlate?:number; samePolicy?:number; recentClaims?:number }
}

const BENIGN_FINDING = /\b(consistente|coincide|compatible|sin (?:señales|inconsistencias|duplicados)|no se (?:encontraron|detectaron)|no hay (?:señales|duplicados))\b/i

export function normalizeAnalysis(value: unknown, context: AnalysisContext = {}) {
  const data = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const findings = Array.isArray(data.findings) ? data.findings.slice(0, 8).map((x) => {
    const f = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const title=String(f.title || 'Hallazgo'); const detail=String(f.detail || '')
    const requestedImpact=Math.max(0,Math.min(35,Number(f.impact)||0))
    return { title, detail, impact:BENIGN_FINDING.test(`${title} ${detail}`)?0:requestedImpact, evidence:String(f.evidence||'Datos del siniestro') }
  }) : []
  const ruleFindings:{title:string;detail:string;impact:number;evidence:string}[]=[]
  if(context.evidenceCount===0)ruleFindings.push({title:'Evidencia pendiente',detail:'El expediente no contiene documentos ni fotografías para contrastar la declaración.',impact:20,evidence:'Expediente'})
  const description=(context.description||'').trim()
  if(description&&description.length<30)ruleFindings.push({title:'Descripción insuficiente',detail:'La descripción es demasiado breve para reconstruir las circunstancias del siniestro.',impact:10,evidence:'Descripción del siniestro'})
  else if(description&&description.length<80)ruleFindings.push({title:'Descripción limitada',detail:'La descripción contiene pocos detalles verificables sobre la ocurrencia.',impact:5,evidence:'Descripción del siniestro'})
  const history=context.history||{}
  const sameIdentity=Math.max(0,history.sameIdentity||0),samePlate=Math.max(0,history.samePlate||0),samePolicy=Math.max(0,history.samePolicy||0),recentClaims=Math.max(0,history.recentClaims||0)
  const historyImpact=Math.min(50,Math.min(30,sameIdentity*15)+Math.min(40,samePlate*20)+Math.min(20,samePolicy*10)+Math.min(20,recentClaims*10))
  if(historyImpact)ruleFindings.push({title:'Historial relacionado',detail:`Coincidencias previas: identidad ${sameIdentity}, placa ${samePlate}, póliza ${samePolicy}; ${recentClaims} dentro de los últimos 30 días.`,impact:historyImpact,evidence:'Historial de siniestros'})
  if(context.occurredAt&&new Date(context.occurredAt).getTime()>Date.now()+5*60_000)ruleFindings.push({title:'Fecha futura',detail:'La fecha declarada del siniestro es posterior al momento del análisis.',impact:25,evidence:'Fecha del siniestro'})
  const modelImpact=Math.min(50,findings.reduce((sum,f)=>sum+f.impact,0))
  const score=Math.max(0,Math.min(100,modelImpact+ruleFindings.reduce((sum,f)=>sum+f.impact,0)))
  const allFindings=[...ruleFindings,...findings].slice(0,8)
  return {
    score,
    risk: score >= 70 ? 'Alto' : score >= 35 ? 'Medio' : 'Bajo',
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    recommendation: score >= 70 ? 'Escalar a investigación' : score >= 35 ? 'Revisión manual prioritaria' : 'Continuar con validaciones habituales',
    summary: String(data.summary || 'Análisis completado'),
    findings:allFindings,
  }
}
