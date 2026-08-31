import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { safeFileName, validateClaim } from './domain.js'

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })
const s3 = new S3Client({})
const sqs = new SQSClient({})
const TABLE_NAME = requiredEnv('TABLE_NAME')
const BUCKET_NAME = requiredEnv('BUCKET_NAME')
const QUEUE_URL = requiredEnv('QUEUE_URL')
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173'

function requiredEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value }
function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'content-type':'application/json', 'access-control-allow-origin':ALLOWED_ORIGIN, 'cache-control':'no-store' }, body: JSON.stringify(body) }
}
function publicClaim(item: Record<string, unknown>) { const { PK: _pk, SK: _sk, identityDocument, ...safe } = item; return { ...safe, identityDocumentMasked: identityDocument ? `***${String(identityDocument).slice(-4)}` : undefined } }

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method
    const path = event.rawPath
    if (method === 'GET' && path === '/health') return response(200, { ok:true })
    if (method === 'POST' && path === '/claims') return await createClaim(event)
    const match = path.match(/^\/claims\/([^/]+)$/)
    if (method === 'GET' && match) return await getClaim(match[1])
    const analyze = path.match(/^\/claims\/([^/]+)\/analyze$/)
    if (method === 'POST' && analyze) return await queueAnalysis(analyze[1])
    return response(404, { message:'Ruta no encontrada' })
  } catch (error) {
    console.error(JSON.stringify({ message:'API failure', error: error instanceof Error ? error.message : String(error) }))
    const message = error instanceof Error ? error.message : 'Error inesperado'
    return response(message.includes('obligatorio') || message.includes('evidencia') || message.includes('archivo') ? 400 : 500, { message })
  }
}

async function createClaim(event: APIGatewayProxyEventV2) {
  const input = validateClaim(JSON.parse(event.body || '{}'))
  const id = `SIN-${new Date().getUTCFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`
  const now = new Date().toISOString()
  const evidence = input.evidence.map((file, index) => ({ ...file, key:`claims/${id}/${index}-${safeFileName(file.name)}`, status:'PENDING_UPLOAD' }))
  const item = { PK:`CLAIM#${id}`, SK:'CLAIM', entityType:'CLAIM', id, ...input, evidence, status:'DRAFT', createdAt:now, updatedAt:now, version:1 }
  await db.send(new PutCommand({ TableName:TABLE_NAME, Item:item, ConditionExpression:'attribute_not_exists(PK)' }))
  const uploadUrls = await Promise.all(evidence.map(async file => ({ key:file.key, name:file.name, url:await getSignedUrl(s3,new PutObjectCommand({Bucket:BUCKET_NAME,Key:file.key,ContentType:file.contentType,Metadata:{claimId:id}}),{expiresIn:600}) })))
  return response(201, { claimId:id, status:'DRAFT', uploadUrls })
}

async function getClaim(id: string) {
  const result = await db.send(new GetCommand({TableName:TABLE_NAME,Key:{PK:`CLAIM#${id}`,SK:'CLAIM'},ConsistentRead:true}))
  return result.Item ? response(200, publicClaim(result.Item)) : response(404,{message:'Siniestro no encontrado'})
}

async function queueAnalysis(id: string) {
  const updated = await db.send(new UpdateCommand({TableName:TABLE_NAME,Key:{PK:`CLAIM#${id}`,SK:'CLAIM'},UpdateExpression:'SET #status=:queued, updatedAt=:now',ConditionExpression:'attribute_exists(PK)',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':queued':'QUEUED',':now':new Date().toISOString()},ReturnValues:'ALL_NEW'}))
  await sqs.send(new SendMessageCommand({QueueUrl:QUEUE_URL,MessageBody:JSON.stringify({claimId:id}),MessageGroupId:undefined}))
  return response(202, { claimId:id, status:updated.Attributes?.status })
}
