import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalysis, safeFileName, validateClaim } from './domain.js'

const valid = { policyNumber:'AUT-1', occurredAt:'2026-08-29T22:40', insuredName:'Laura', identityDocument:'0801', vehicle:'SUV', plate:'hab 1234', location:'Tegucigalpa', description:'Colisión', evidence:[{name:'foto frontal.jpg',contentType:'image/jpeg',size:1024}] }

test('valida y normaliza un siniestro', () => assert.equal(validateClaim(valid).plate, 'HAB 1234'))
test('rechaza tipos de archivo peligrosos', () => assert.throws(() => validateClaim({...valid,evidence:[{name:'x.html',contentType:'text/html',size:10}]})))
test('sanea rutas e ignora el score libre del modelo', () => { assert.equal(safeFileName('../../foto á.jpg'), 'foto_a.jpg'); assert.equal(normalizeAnalysis({score:150}).score,0) })
test('calcula el score desde hallazgos y reglas, no desde el valor libre del modelo',()=>{
  const result=normalizeAnalysis({score:65,findings:[
    {title:'Información consistente',detail:'La fotografía coincide con la declaración',impact:20,evidence:'Imagen'},
    {title:'Daño no explicado',detail:'El patrón no corresponde con la mecánica declarada',impact:18,evidence:'Imagen'},
  ]},{evidenceCount:1,description:'Choque lateral',history:{sameIdentity:1,samePolicy:1,recentClaims:1}})
  assert.equal(result.score,63)
  assert.equal(result.risk,'Medio')
  assert.equal(result.findings[2].impact,0)
})

test('correlaciona identidad, placa, póliza y recurrencia sin exceder el peso histórico',()=>{
  const result=normalizeAnalysis({findings:[]},{evidenceCount:1,description:'Descripción suficientemente detallada del accidente para realizar las validaciones del expediente.',history:{sameIdentity:4,samePlate:3,samePolicy:4,recentClaims:4}})
  assert.equal(result.score,50)
  assert.match(result.findings[0].detail,/identidad 4, placa 3, póliza 4/)
})
