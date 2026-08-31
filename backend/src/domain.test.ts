import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalysis, safeFileName, validateClaim } from './domain.js'

const valid = { policyNumber:'AUT-1', occurredAt:'2026-08-29T22:40', insuredName:'Laura', identityDocument:'0801', vehicle:'SUV', plate:'hab 1234', location:'Tegucigalpa', description:'Colisión', evidence:[{name:'foto frontal.jpg',contentType:'image/jpeg',size:1024}] }

test('valida y normaliza un siniestro', () => assert.equal(validateClaim(valid).plate, 'HAB 1234'))
test('rechaza tipos de archivo peligrosos', () => assert.throws(() => validateClaim({...valid,evidence:[{name:'x.html',contentType:'text/html',size:10}]})))
test('sanea rutas y limita el score', () => { assert.equal(safeFileName('../../foto á.jpg'), 'foto_a.jpg'); assert.equal(normalizeAnalysis({score:150}).score,100) })
