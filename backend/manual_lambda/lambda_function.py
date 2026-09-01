"""Lambda única para registrar y analizar siniestros desde una Function URL."""
import base64, json, logging, os, re, unicodedata, uuid
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

LOG=logging.getLogger(); LOG.setLevel(logging.INFO)
REGION=os.environ.get('AWS_REGION','us-east-1')
TABLE_NAME=os.environ.get('CLAIMS_TABLE','')
BUCKET_NAME=os.environ.get('EVIDENCE_BUCKET','')
MODEL_ID=os.environ.get('BEDROCK_MODEL_ID','amazon.nova-lite-v1:0')
ORIGIN=os.environ.get('ALLOWED_ORIGIN','http://localhost:5173')
ALLOWED={'application/pdf','image/jpeg','image/png','image/tiff'}
MAX_SIZE=4*1024*1024; MAX_FILES=10
ddb=boto3.resource('dynamodb',region_name=REGION)
s3=boto3.client('s3',region_name=REGION)
textract=boto3.client('textract',region_name=REGION)
rekognition=boto3.client('rekognition',region_name=REGION)
bedrock=boto3.client('bedrock-runtime',region_name=REGION)

def lambda_handler(event,context):
    try:
        if not TABLE_NAME or not BUCKET_NAME: raise RuntimeError('Configura CLAIMS_TABLE y EVIDENCE_BUCKET')
        http=event.get('requestContext',{}).get('http',{})
        method=(http.get('method') or event.get('httpMethod') or 'GET').upper()
        path=event.get('rawPath') or event.get('path') or '/'
        if method=='OPTIONS': return response(204,None)
        if method=='GET' and path in ('/','/health'): return response(200,{'ok':True,'service':'ficohsa-claims'})
        if method=='GET' and path=='/claims': return list_claims()
        if method=='POST' and path=='/claims': return create_claim(body(event))
        upload=re.fullmatch(r'/claims/([^/]+)/evidence/(\d+)',path)
        if method=='PUT' and upload: return upload_evidence(upload.group(1),int(upload.group(2)),event)
        match=re.fullmatch(r'/claims/([^/]+)/analyze',path)
        if method=='POST' and match: return analyze_claim(match.group(1))
        match=re.fullmatch(r'/claims/([^/]+)',path)
        if method=='GET' and match: return get_claim(match.group(1))
        return response(404,{'message':'Ruta no encontrada'})
    except ValueError as error: return response(400,{'message':str(error)})
    except ClientError as error:
        code=error.response.get('Error',{}).get('Code','AWS_ERROR'); LOG.exception('AWS error %s',code)
        return response(500,{'message':'No fue posible procesar el siniestro','code':code})
    except Exception: LOG.exception('Unexpected error'); return response(500,{'message':'Error interno inesperado'})

def create_claim(payload):
    claim=validate_claim(payload); claim_id=f"SIN-{datetime.now(timezone.utc).year}-{uuid.uuid4().hex[:8].upper()}"; now=utc_now()
    evidence=[]; upload_urls=[]
    for index,file in enumerate(claim.pop('evidence')):
        key=f"claims/{claim_id}/{index}-{safe_name(file['name'])}"; evidence.append({**file,'key':key,'status':'PENDING_UPLOAD'})
        upload_urls.append({'key':key,'name':file['name'],'path':f'/claims/{claim_id}/evidence/{index}'})
    table().put_item(Item={'id':claim_id,**claim,'evidence':evidence,'status':'DRAFT','createdAt':now,'updatedAt':now,'version':1},ConditionExpression='attribute_not_exists(id)')
    return response(201,{'claimId':claim_id,'status':'DRAFT','uploadUrls':upload_urls})

def upload_evidence(claim_id,index,event):
    item=table().get_item(Key={'id':claim_id},ConsistentRead=True).get('Item')
    if not item:return response(404,{'message':'Siniestro no encontrado'})
    evidence=item.get('evidence',[])
    if index<0 or index>=len(evidence):return response(404,{'message':'Evidencia no encontrada'})
    file=evidence[index]; headers={str(key).lower():value for key,value in event.get('headers',{}).items()}
    content_type=str(headers.get('content-type','')).split(';',1)[0].strip().lower()
    if content_type!=file.get('contentType'):raise ValueError('El tipo de la evidencia no coincide con el registro')
    encoded=event.get('body') or ''
    try:data=base64.b64decode(encoded,validate=True) if event.get('isBase64Encoded') else encoded.encode('utf-8')
    except (ValueError,UnicodeError) as error:raise ValueError('El contenido de la evidencia es inválido') from error
    if not data or len(data)>MAX_SIZE:raise ValueError('La evidencia debe pesar entre 1 byte y 4 MB')
    if file.get('size')!=len(data):raise ValueError('El tamaño de la evidencia no coincide con el registro')
    s3.put_object(Bucket=BUCKET_NAME,Key=file['key'],Body=data,ContentType=content_type,Metadata={'claim-id':claim_id})
    table().update_item(Key={'id':claim_id},UpdateExpression=f'SET evidence[{index}].#s=:uploaded, updatedAt=:now',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':uploaded':'UPLOADED',':now':utc_now()})
    return response(200,{'claimId':claim_id,'index':index,'status':'UPLOADED'})

def get_claim(claim_id):
    item=table().get_item(Key={'id':claim_id},ConsistentRead=True).get('Item')
    if not item: return response(404,{'message':'Siniestro no encontrado'})
    result=json_safe(item); identity=result.pop('identityDocument',''); result['identityDocumentMasked']=f"***{identity[-4:]}" if identity else None
    return response(200,result)

def list_claims():
    items=[]; cursor=None
    while True:
        args={'Limit':100}
        if cursor: args['ExclusiveStartKey']=cursor
        page=table().scan(**args); items.extend(page.get('Items',[])); cursor=page.get('LastEvaluatedKey')
        if not cursor: break
    items.sort(key=lambda item:item.get('createdAt',''),reverse=True)
    safe=[]
    for item in items:
        value=json_safe(item); identity=value.pop('identityDocument','')
        value['identityDocumentMasked']=f"***{identity[-4:]}" if identity else None
        safe.append(value)
    return response(200,{'items':safe,'count':len(safe)})

def analyze_claim(claim_id):
    item=table().get_item(Key={'id':claim_id},ConsistentRead=True).get('Item')
    if not item: return response(404,{'message':'Siniestro no encontrado'})
    if item.get('status')=='COMPLETED': return response(200,{'claimId':claim_id,'status':'COMPLETED'})
    set_status(claim_id,'ANALYZING')
    try:
        ocr,visual=inspect_evidence(item.get('evidence',[]))
        model_input={'claim':{key:item.get(key) for key in ('policyNumber','occurredAt','vehicle','plate','location','description')},'ocr':ocr,'visualLabels':visual,'possibleDuplicates':find_duplicates(claim_id,item.get('plate',''))}
        analysis=invoke_model(model_input); now=utc_now()
        table().update_item(Key={'id':claim_id},UpdateExpression='SET #s=:s, analysis=:a, analysisEngine=:e, analyzedAt=:n, updatedAt=:n',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':s':'COMPLETED',':a':to_ddb(analysis),':e':MODEL_ID,':n':now})
        return response(202,{'claimId':claim_id,'status':'COMPLETED'})
    except Exception as error:
        LOG.exception('Analysis failed for %s',claim_id)
        table().update_item(Key={'id':claim_id},UpdateExpression='SET #s=:s, analysisError=:e, updatedAt=:n',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':s':'FAILED',':e':str(error)[:500],':n':utc_now()})
        raise

def inspect_evidence(evidence):
    ocr=[]; visual=[]
    for file in evidence[:MAX_FILES]:
        key=file['key']; name=file['name']
        try:
            s3.head_object(Bucket=BUCKET_NAME,Key=key)
            result=textract.detect_document_text(Document={'S3Object':{'Bucket':BUCKET_NAME,'Name':key}})
            text='\n'.join(b['Text'] for b in result.get('Blocks',[]) if b.get('BlockType')=='LINE' and b.get('Text'))
            ocr.append({'file':name,'text':text[:12000]})
        except ClientError as error: ocr.append({'file':name,'warning':error.response.get('Error',{}).get('Code','OCR_ERROR')})
        if file.get('contentType') in ('image/jpeg','image/png'):
            try:
                result=rekognition.detect_labels(Image={'S3Object':{'Bucket':BUCKET_NAME,'Name':key}},MaxLabels=20,MinConfidence=75)
                visual.append({'file':name,'labels':[{'name':x.get('Name'),'confidence':round(x.get('Confidence',0),1)} for x in result.get('Labels',[])]})
            except ClientError as error: visual.append({'file':name,'warning':error.response.get('Error',{}).get('Code','VISION_ERROR')})
    return ocr,visual

def find_duplicates(claim_id,plate):
    if not plate:return []
    result=table().scan(FilterExpression=Attr('plate').eq(plate),ProjectionExpression='id, occurredAt, #s, analysis',ExpressionAttributeNames={'#s':'status'},Limit=50)
    return [{'id':x.get('id'),'occurredAt':x.get('occurredAt'),'status':x.get('status'),'score':x.get('analysis',{}).get('score')} for x in result.get('Items',[]) if x.get('id')!=claim_id][:5]

def invoke_model(data):
    system='Eres un asistente antifraude para seguros de autos. No determines culpabilidad, no confirmes fraude y no apruebes ni rechaces reclamos. Evalúa señales explicables y recomienda revisión humana. Responde solo JSON válido con score 0-100, confidence 0-1, recommendation, summary y findings: [{title,detail,impact,evidence}].'
    result=bedrock.converse(modelId=MODEL_ID,system=[{'text':system}],messages=[{'role':'user','content':[{'text':'Analiza sin inventar hechos:\n'+json.dumps(data,ensure_ascii=False)}]}],inferenceConfig={'maxTokens':1800,'temperature':0})
    text=result['output']['message']['content'][0]['text']; match=re.search(r'\{.*\}',text,re.DOTALL)
    if not match: raise ValueError('Bedrock no devolvió JSON válido')
    return normalize_analysis(json.loads(match.group(0)))

def normalize_analysis(data):
    score=max(0,min(100,int(number(data.get('score',0),{'alto':85,'high':85,'medio':50,'medium':50,'bajo':20,'low':20})))); confidence=max(0,min(1,number(data.get('confidence',0),{'alta':.9,'high':.9,'media':.6,'medium':.6,'baja':.3,'low':.3})))
    findings=[]
    for x in data.get('findings',[])[:8]:
        if isinstance(x,dict): findings.append({'title':str(x.get('title','Hallazgo'))[:160],'detail':str(x.get('detail',''))[:1000],'impact':max(0,min(40,int(number(x.get('impact',0),{'alto':30,'high':30,'medio':18,'medium':18,'bajo':7,'low':7})))),'evidence':str(x.get('evidence','Datos del siniestro'))[:300]})
    return {'score':score,'risk':'Alto' if score>=70 else 'Medio' if score>=35 else 'Bajo','confidence':confidence,'recommendation':str(data.get('recommendation','Revisión manual'))[:500],'summary':str(data.get('summary','Análisis completado'))[:1000],'findings':findings}

def number(value,labels=None):
    if isinstance(value,(int,float,Decimal)):return float(value)
    text=str(value).strip().lower().replace(',','.')
    if labels and text in labels:return float(labels[text])
    match=re.search(r'-?\d+(?:\.\d+)?',text)
    return float(match.group(0)) if match else 0.0

def validate_claim(payload):
    if not isinstance(payload,dict):raise ValueError('El cuerpo es inválido')
    required=('policyNumber','occurredAt','insuredName','identityDocument','vehicle','plate','location','description'); claim={}
    for field in required:
        value=payload.get(field)
        if not isinstance(value,str) or not value.strip():raise ValueError(f'El campo {field} es obligatorio')
        claim[field]=value.strip()
    claim['plate']=claim['plate'].upper()
    if len(claim['description'])>2000:raise ValueError('La descripción excede 2000 caracteres')
    files=payload.get('evidence',[])
    if not isinstance(files,list) or len(files)>MAX_FILES:raise ValueError(f'Solo se permiten {MAX_FILES} archivos')
    evidence=[]
    for file in files:
        name=str(file.get('name','')).strip() if isinstance(file,dict) else ''; content_type=file.get('contentType') if isinstance(file,dict) else None; size=file.get('size') if isinstance(file,dict) else None
        if not name or content_type not in ALLOWED:raise ValueError(f'Tipo de archivo no permitido: {content_type}')
        if not isinstance(size,int) or size<=0 or size>MAX_SIZE:raise ValueError(f'El archivo {name} debe pesar menos de 4 MB')
        evidence.append({'name':name[:160],'contentType':content_type,'size':size})
    claim['evidence']=evidence; return claim

def safe_name(name):
    base=re.split(r'[\\/]',name)[-1]; value=unicodedata.normalize('NFKD',base).encode('ascii','ignore').decode(); value=re.sub(r'[^a-zA-Z0-9._-]','_',value); return re.sub(r'_+','_',value).lstrip('.')[:160] or 'archivo'
def body(event):
    if event.get('isBase64Encoded'):raise ValueError('No envíes archivos en base64; usa las URLs firmadas')
    try:return json.loads(event.get('body') or '{}')
    except json.JSONDecodeError as error:raise ValueError('El cuerpo debe ser JSON válido') from error
def table():return ddb.Table(TABLE_NAME)
def utc_now():return datetime.now(timezone.utc).isoformat()
def set_status(claim_id,status):table().update_item(Key={'id':claim_id},UpdateExpression='SET #s=:s, updatedAt=:n',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':s':status,':n':utc_now()})
def to_ddb(value):return json.loads(json.dumps(value,ensure_ascii=False),parse_float=Decimal)
def json_safe(value):
    if isinstance(value,Decimal):return int(value) if value%1==0 else float(value)
    if isinstance(value,list):return [json_safe(x) for x in value]
    if isinstance(value,dict):return {k:json_safe(v) for k,v in value.items()}
    return value
def response(status,body_value):
    headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,authorization','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Cache-Control':'no-store'}
    if body_value is None:return {'statusCode':status,'headers':headers,'body':''}
    headers['Content-Type']='application/json'; return {'statusCode':status,'headers':headers,'body':json.dumps(json_safe(body_value),ensure_ascii=False)}
