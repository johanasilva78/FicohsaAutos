# Ficohsa Autos — Gestión inteligente de siniestros

MVP navegable para automatizar la detección de posibles fraudes en siniestros de autos. Traduce los requerimientos funcionales del RFP a una experiencia de producto preparada para evolucionar hacia una solución SaaS regional.

## Funcionalidad incluida

- Dashboard ejecutivo con indicadores, tendencias y distribución de riesgo.
- Bandeja de siniestros con búsqueda y filtros.
- Flujo de alta en tres pasos con validación de póliza y carga documental.
- Resultado explicable del scoring, hallazgos, evidencia y trazabilidad.
- Reportes operativos y de efectividad.
- Diseño responsive alineado al lenguaje visual azul/rojo de Ficohsa.

La información, el análisis OCR/IA, las notificaciones y las integraciones son demostrativos. Para producción deben conectarse a servicios autenticados, APIs internas y servicios administrados de AWS.

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

Para una implementación productiva se recomienda Amplify Gen 2 con Cognito (perfiles y MFA), AppSync/Lambda (APIs), DynamoDB (casos y auditoría), S3 (evidencias con cifrado), Textract (OCR), Rekognition/SageMaker (señales de imagen y modelos), SES/SNS (notificaciones) y CloudWatch/CloudTrail (observabilidad y auditoría).

## Aviso

Este repositorio es un prototipo funcional de interfaz. No debe utilizar datos personales o expedientes reales hasta completar controles de seguridad, privacidad, retención, segregación por país y validación formal de los modelos.
