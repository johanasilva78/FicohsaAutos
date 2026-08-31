import type { SQSEvent, SQSBatchResponse } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { DetectDocumentTextCommand, TextractClient } from '@aws-sdk/client-textract'
import { DetectLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { normalizeAnalysis } from './domain.js'

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {marshallOptions:{removeUndefinedValues:true}})
const textract = new TextractClient({})
const rekognition = new RekognitionClient({})
const bedrock = new BedrockRuntimeClient({})
const TABLE_NAME = requiredEnv('TABLE_NAME')
const BUCKET_NAME = requiredEnv('BUCKET_NAME')
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0'
function requiredEnv(name:string){const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: {itemIdentifier:string}[] = []
  for (const record of event.Records) {
    try { const {claimId}=JSON.parse(record.body); await analyzeClaim(claimId) }
    catch(error){ console.error(JSON.stringify({message:'Analysis failed',messageId:record.messageId,error:error instanceof Error?error.message:String(error)})); failures.push({itemIdentifier:record.messageId}) }
  }
  return {batchItemFailures:failures}
}

async function analyzeClaim(id:string) {
  const key={PK:`CLAIM#${id}`,SK:'CLAIM'}
  const current=await db.send(new GetCommand({TableName:TABLE_NAME,Key:key,ConsistentRead:true}))
  if(!current.Item) throw new Error(`Claim ${id} not found`)
  if(current.Item.status==='COMPLETED') return
  try {
    await db.send(new UpdateCommand({TableName:TABLE_NAME,Key:key,UpdateExpression:'SET #status=:status, updatedAt=:now',ConditionExpression:'#status IN (:queued, :failed)',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':status':'ANALYZING',':queued':'QUEUED',':failed':'FAILED',':now':new Date().toISOString()}}))
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return
    throw error
  }
  try {
    const evidence=Array.isArray(current.Item.evidence)?current.Item.evidence:[]
    const extracted:string[]=[]; const visual:string[]=[]
    for(const file of evidence.slice(0,10)){
      try {
        const ocr=await textract.send(new DetectDocumentTextCommand({Document:{S3Object:{Bucket:BUCKET_NAME,Name:file.key}}}))
        const lines=(ocr.Blocks||[]).filter(b=>b.BlockType==='LINE'&&b.Text).map(b=>b.Text!).join('\n')
        extracted.push(`${file.name}:\n${lines.slice(0,12000)}`)
      }catch(error){extracted.push(`${file.name}: OCR no disponible (${error instanceof Error?error.name:'error'})`)}
      if(String(file.contentType).startsWith('image/')) try {
        const labels=await rekognition.send(new DetectLabelsCommand({Image:{S3Object:{Bucket:BUCKET_NAME,Name:file.key}},MaxLabels:20,MinConfidence:75,Features:['GENERAL_LABELS']}))
        visual.push(`${file.name}: ${(labels.Labels||[]).map(l=>`${l.Name} (${Math.round(l.Confidence||0)}%)`).join(', ')}`)
      }catch(error){visual.push(`${file.name}: visión no disponible (${error instanceof Error?error.name:'error'})`)}
    }
    const duplicates=await db.send(new QueryCommand({TableName:TABLE_NAME,IndexName:'PlateIndex',KeyConditionExpression:'plate=:plate',ExpressionAttributeValues:{':plate':current.Item.plate},Limit:6}))
    const previous=(duplicates.Items||[]).filter(x=>x.id!==id).map(x=>({id:x.id,occurredAt:x.occurredAt,status:x.status,score:x.analysis?.score}))
    const prompt=JSON.stringify({claim:{policyNumber:current.Item.policyNumber,occurredAt:current.Item.occurredAt,insuredName:current.Item.insuredName,vehicle:current.Item.vehicle,plate:current.Item.plate,location:current.Item.location,description:current.Item.description},ocr:extracted,visualLabels:visual,possibleDuplicates:previous})
    const result=await bedrock.send(new ConverseCommand({modelId:MODEL_ID,system:[{text:'Eres un asistente antifraude para seguros de autos. No determines culpabilidad ni rechaces reclamos. Evalúa señales explicables, señala datos faltantes y recomienda revisión humana. Responde únicamente JSON válido con score (0-100), confidence (0-1), recommendation, summary y findings: [{title,detail,impact,evidence}].'}],messages:[{role:'user',content:[{text:`Analiza este expediente. No inventes hechos ni trates una señal como fraude confirmado:\n${prompt}`}]}],inferenceConfig:{temperature:0,maxTokens:1800}}))
    const text=result.output?.message?.content?.find(x=>'text' in x)?.text||'{}'
    const analysis=normalizeAnalysis(JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')))
    await db.send(new UpdateCommand({TableName:TABLE_NAME,Key:key,UpdateExpression:'SET #status=:done, analysis=:analysis, analysisEngine=:engine, analyzedAt=:now, updatedAt=:now',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':done':'COMPLETED',':analysis':analysis,':engine':MODEL_ID,':now':new Date().toISOString()}}))
  } catch(error) {
    await db.send(new UpdateCommand({TableName:TABLE_NAME,Key:key,UpdateExpression:'SET #status=:failed, analysisError=:message, updatedAt=:now',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':failed':'FAILED',':message':error instanceof Error?error.message:'Analysis failed',':now':new Date().toISOString()}}))
    throw error
  }
}
