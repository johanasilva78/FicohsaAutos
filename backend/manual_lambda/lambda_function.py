"""Lambda única para registrar y analizar siniestros desde una Function URL."""
import base64, json, logging, os, re, unicodedata, uuid
from datetime import datetime, timezone
from decimal import Decimal
import boto3
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
        evidence=item.get('evidence',[]); ocr,visual=inspect_evidence(evidence); history=related_history(claim_id,item)
        model_input={'claim':{key:item.get(key) for key in ('policyNumber','occurredAt','vehicle','plate','location','description')},'ocr':ocr,'visualLabels':visual,'relatedHistory':history['matches']}
        context={'evidenceCount':len(evidence),'description':item.get('description',''),'occurredAt':item.get('occurredAt'),'history':history['counts']}
        analysis=invoke_model(model_input,context); now=utc_now()
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

def related_history(claim_id,current):
    page=table().scan(ProjectionExpression='id, identityDocument, plate, policyNumber, occurredAt, #s, analysis',ExpressionAttributeNames={'#s':'status'},Limit=100)
    related=[]
    for item in page.get('Items',[]):
        if item.get('id')==claim_id:continue
        flags={'identity':bool(current.get('identityDocument')) and item.get('identityDocument')==current.get('identityDocument'),'plate':bool(current.get('plate')) and item.get('plate')==current.get('plate'),'policy':bool(current.get('policyNumber')) and item.get('policyNumber')==current.get('policyNumber')}
        if any(flags.values()):related.append((item,flags))
    counts={'sameIdentity':sum(flags['identity'] for _,flags in related),'samePlate':sum(flags['plate'] for _,flags in related),'samePolicy':sum(flags['policy'] for _,flags in related),'recentClaims':sum(is_recent(item.get('occurredAt'),current.get('occurredAt')) for item,_ in related)}
    matches=[{'id':item.get('id'),'occurredAt':item.get('occurredAt'),'status':item.get('status'),'score':item.get('analysis',{}).get('score'),'matches':flags} for item,flags in related[:10]]
    return {'counts':counts,'matches':matches}

def is_recent(previous,current):
    try:return abs((datetime.fromisoformat(str(current).replace('Z','+00:00'))-datetime.fromisoformat(str(previous).replace('Z','+00:00'))).total_seconds())<=30*86400
    except (TypeError,ValueError):return False

def invoke_model(data,context):
    system='Eres un asistente antifraude para seguros de autos. No determines culpabilidad, no confirmes fraude y no apruebes ni rechaces reclamos. Identifica únicamente anomalías sustentadas en evidencia. Usa impact 0 si la información es consistente o no hay anomalía; 5-15 para señal débil; 16-25 para inconsistencia material; 26-35 solo para duplicidad o manipulación fuertemente sustentada. No calcules el score global: el sistema lo hará con reglas auditables. Responde solo JSON válido con confidence 0-1, recommendation, summary y findings: [{title,detail,impact,evidence}].'
    result=bedrock.converse(modelId=MODEL_ID,system=[{'text':system}],messages=[{'role':'user','content':[{'text':'Analiza sin inventar hechos:\n'+json.dumps(json_safe(data),ensure_ascii=False)}]}],inferenceConfig={'maxTokens':1800,'temperature':0})
    text=result['output']['message']['content'][0]['text']; match=re.search(r'\{.*\}',text,re.DOTALL)
    if not match: raise ValueError('Bedrock no devolvió JSON válido')
    return normalize_analysis(json.loads(match.group(0)),context)

def normalize_analysis(data,context=None):
    context=context or {}; confidence=max(0,min(1,number(data.get('confidence',0),{'alta':.9,'high':.9,'media':.6,'medium':.6,'baja':.3,'low':.3})))
    benign=re.compile(r'\b(consistente|coincide|compatible|sin (?:señales|inconsistencias|duplicados)|no se (?:encontraron|detectaron)|no hay (?:señales|duplicados))\b',re.IGNORECASE)
    findings=[]
    for x in data.get('findings',[])[:8]:
        if isinstance(x,dict):
            title=str(x.get('title','Hallazgo'))[:160]; detail=str(x.get('detail',''))[:1000]; impact=max(0,min(35,int(number(x.get('impact',0),{'alto':30,'high':30,'medio':18,'medium':18,'bajo':7,'low':7}))))
            findings.append({'title':title,'detail':detail,'impact':0 if benign.search(f'{title} {detail}') else impact,'evidence':str(x.get('evidence','Datos del siniestro'))[:300]})
    rules=[]; evidence_count=int(context.get('evidenceCount',0)); description=str(context.get('description','')).strip()
    if evidence_count==0:rules.append({'title':'Evidencia pendiente','detail':'El expediente no contiene documentos ni fotografías para contrastar la declaración.','impact':20,'evidence':'Expediente'})
    if description and len(description)<30:rules.append({'title':'Descripción insuficiente','detail':'La descripción es demasiado breve para reconstruir las circunstancias del siniestro.','impact':10,'evidence':'Descripción del siniestro'})
    elif description and len(description)<80:rules.append({'title':'Descripción limitada','detail':'La descripción contiene pocos detalles verificables sobre la ocurrencia.','impact':5,'evidence':'Descripción del siniestro'})
    history=context.get('history') or {}; same_identity=max(0,int(history.get('sameIdentity',0))); same_plate=max(0,int(history.get('samePlate',0))); same_policy=max(0,int(history.get('samePolicy',0))); recent=max(0,int(history.get('recentClaims',0)))
    history_impact=min(50,min(30,same_identity*15)+min(40,same_plate*20)+min(20,same_policy*10)+min(20,recent*10))
    if history_impact:rules.append({'title':'Historial relacionado','detail':f'Coincidencias previas: identidad {same_identity}, placa {same_plate}, póliza {same_policy}; {recent} dentro de los últimos 30 días.','impact':history_impact,'evidence':'Historial de siniestros'})
    try:
        occurred=datetime.fromisoformat(str(context.get('occurredAt')).replace('Z','+00:00')); now=datetime.now(occurred.tzinfo) if occurred.tzinfo else datetime.now()
        if (occurred-now).total_seconds()>300:rules.append({'title':'Fecha futura','detail':'La fecha declarada del siniestro es posterior al momento del análisis.','impact':25,'evidence':'Fecha del siniestro'})
    except (TypeError,ValueError):pass
    score=max(0,min(100,min(50,sum(x['impact'] for x in findings))+sum(x['impact'] for x in rules))); recommendation='Escalar a investigación' if score>=70 else 'Revisión manual prioritaria' if score>=35 else 'Continuar con validaciones habituales'
    return {'score':score,'risk':'Alto' if score>=70 else 'Medio' if score>=35 else 'Bajo','confidence':confidence,'recommendation':recommendation,'summary':str(data.get('summary','Análisis completado'))[:1000],'findings':(rules+findings)[:8]}

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
