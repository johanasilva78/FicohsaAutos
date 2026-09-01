# Lambda Python manual

No requiere AWS SAM. Crea primero una tabla DynamoDB con partition key `id` (String) y un bucket S3 privado en la misma región.

Configura la Lambda con Python 3.13, handler `lambda_function.lambda_handler`, 1024 MB y timeout de 2 minutos. Variables:

```text
CLAIMS_TABLE=ficohsa-autos-claims
EVIDENCE_BUCKET=nombre-del-bucket
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
ALLOWED_ORIGIN=https://main.APP_ID.amplifyapp.com
```

El rol requiere CloudWatch Logs; DynamoDB `GetItem`, `PutItem`, `UpdateItem`, `Scan`; S3 `PutObject`, `GetObject`, `HeadObject`; `textract:DetectDocumentText`; `rekognition:DetectLabels`; y `bedrock:InvokeModel`.

Todas las operaciones HTTP pasan por la misma Function URL, incluida la carga de evidencias mediante `PUT /claims/{id}/evidence/{index}`. La Lambda guarda cada archivo en el bucket privado, por lo que el navegador no requiere CORS ni acceso directo a S3. Debido al límite de entrada síncrona de Lambda, cada archivo puede pesar hasta 4 MB.

Habilita Function URL y permite `GET`, `POST`, `PUT` y `OPTIONS` para el dominio de Amplify. `Auth type NONE` sirve solo con datos ficticios; para datos reales usa AWS IAM o un API Gateway con JWT.

`ALLOWED_ORIGIN` debe contener únicamente el origen HTTPS, sin formato Markdown y sin `/` al final.
