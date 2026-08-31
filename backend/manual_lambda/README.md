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

Habilita Function URL y configura CORS con el dominio de Amplify. `Auth type NONE` sirve solo con datos ficticios; para datos reales usa AWS IAM o un API Gateway con JWT.
