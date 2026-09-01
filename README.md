# Ficohsa Autos — Gestión inteligente de siniestros

MVP navegable para automatizar la detección de posibles fraudes en siniestros de autos. Traduce los requerimientos funcionales del RFP a una experiencia de producto preparada para evolucionar hacia una solución SaaS regional.

## Funcionalidad incluida

- Dashboard ejecutivo con indicadores, tendencias y distribución de riesgo.
- Bandeja de siniestros con búsqueda y filtros.
- Flujo de alta en tres pasos con validación de póliza y carga documental.
- Resultado explicable del scoring, hallazgos, evidencia y trazabilidad.
- Reportes operativos y de efectividad.
- Diseño responsive alineado al lenguaje visual azul/rojo de Ficohsa.

La interfaz consume los siniestros del backend serverless incluido, desplegable con Lambda, API Gateway, S3, DynamoDB, SQS, Textract, Rekognition y Amazon Bedrock. Si la API no está configurada, muestra un estado de conexión explícito y no inyecta expedientes de demostración.

## Desarrollo local

```bash
npm install
npm run dev
```

Validación de producción:

```bash
npm run build
npm run preview
```

## Despliegue en AWS Amplify Hosting

El archivo `amplify.yml` contiene la configuración de compilación. En Amplify Hosting:

1. Crear una aplicación y conectar este repositorio de GitHub.
2. Seleccionar la rama `main`.
3. Confirmar que el directorio de salida sea `dist`.
4. Desplegar.

## Backend Lambda e IA

El directorio `backend/` contiene una aplicación AWS SAM. El flujo evita enviar archivos grandes a Lambda:

1. `POST /claims` valida el expediente, lo registra en DynamoDB y entrega URLs firmadas por 10 minutos.
2. El navegador carga las evidencias directamente al bucket privado S3.
3. `POST /claims/{id}/analyze` envía un trabajo idempotente a SQS.
4. La Lambda de análisis ejecuta OCR con Textract, etiquetas visuales con Rekognition, búsqueda de casos con la misma placa y scoring explicable con Bedrock.
5. `GET /claims/{id}` permite consultar el resultado o el estado del proceso.

Requisitos: AWS CLI y AWS SAM CLI configurados, Node.js 22, acceso habilitado al modelo de Bedrock en la misma región y permisos para crear el stack.

```bash
cd backend
npm install
npm test
sam build
sam deploy --guided
```

Durante `sam deploy --guided`, establece `AllowedOrigin` con el dominio exacto de Amplify, por ejemplo `https://main.xxxxx.amplifyapp.com`. Al terminar, copia el output `ApiUrl` y crea en Amplify Hosting las variables:

```text
VITE_API_URL=https://API_ID.execute-api.REGION.amazonaws.com/v1
```

Luego redespliega el frontend. Para desarrollo local, copia `.env.example` a `.env.local` y ajusta la URL. El endpoint no debe exponerse a expedientes reales hasta agregar un autorizador JWT de Cognito o del proveedor corporativo, WAF, política de retención aprobada y pruebas de seguridad. CORS no sustituye autenticación.

### Despliegue con una sola Function URL

La implementación utilizada por este proyecto está en `backend/manual_lambda/lambda_function.py`. Expone listado, registro, carga de evidencias, análisis y consulta desde una única Lambda URL, sin API Gateway. Consulta `backend/manual_lambda/README.md` para sus variables, permisos y límites. Configura el frontend así:

```text
VITE_API_URL=https://FUNCTION_ID.lambda-url.REGION.on.aws
```

## Aviso

El scoring de IA es una recomendación explicable y nunca una decisión automática de rechazo. No debe utilizar datos personales o expedientes reales hasta completar autenticación, controles de privacidad, retención, segregación por país, supervisión humana y validación formal del modelo.
